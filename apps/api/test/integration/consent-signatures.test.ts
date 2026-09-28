import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import { OBJECT_STORAGE, type ObjectStorage } from '../../src/lib/storage/storage.types';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, publishConsent, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface TemplateBody {
  id: string;
  name: string;
  validityDays: number | null;
  archived: boolean;
  active: { id: string; version: number; sha256: string; body: string } | null;
  draft: { id: string; body: string } | null;
  serviceIds: string[];
}
interface RequirementItem {
  kind: 'kvkk_explicit' | 'treatment';
  templateId: string | null;
  title: string;
  satisfied: boolean;
  signatureId: string | null;
  document: { documentId: string; sha256: string; body: string; version: number } | null;
}
interface RequirementsBody {
  customerName: string;
  items: RequirementItem[];
  missingCount: number;
}
interface SignatureSummary {
  id: string;
  kind: string;
  documentTitle: string;
  documentVersion: number;
  signerName: string;
  pdfSha256: string;
  collectedBy: { id: string; name: string } | null;
}
interface Problem {
  code: string;
  missing?: { title: string }[];
}

const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;
const TREATMENT_BODY =
  'Botoks uygulamasının riskleri: morarma, geçici asimetri, baş ağrısı. Şişlik ve ğüşiöç.';

/** Saydam zeminde siyah bir çizgi — tablette atılan imzanın taklidi. */
async function signaturePng(): Promise<string> {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="150">' +
      '<path d="M20 120 C 80 20, 160 20, 200 90 S 320 140, 380 30" stroke="#111" stroke-width="4" fill="none"/>' +
      '</svg>',
  );
  const png = await sharp(svg).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function blankPng(): Promise<string> {
  const png = await sharp({
    create: { width: 400, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  return png.toString('base64');
}

describe('klinikte imzalı onam (0053)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let storage: ObjectStorage;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
    storage = app.get<ObjectStorage>(OBJECT_STORAGE);
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app, { slug: 'onam-klinik' });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);

  async function createTemplate(
    overrides: { name?: string; validityDays?: number | null; body?: string } = {},
  ): Promise<TemplateBody> {
    const created = await http(app)
      .post('/api/v1/consent-templates')
      .set(ownerAuth())
      .send({ name: 'Botoks onamı', body: TREATMENT_BODY, ...overrides })
      .expect(201);
    const id = (created.body as TemplateBody).id;
    const published = await http(app)
      .post(`/api/v1/consent-templates/${id}/publish`)
      .set(ownerAuth())
      .expect(200);
    return published.body as TemplateBody;
  }

  async function linkToService(templateIds: string[], serviceId = clinic.quickService.id) {
    await http(app)
      .put(`/api/v1/services/${serviceId}/consent-templates`)
      .set(ownerAuth())
      .send({ templateIds })
      .expect(200);
  }

  async function createAppointment(startsAt = at('10:00')): Promise<string> {
    const res = await http(app)
      .post('/api/v1/appointments')
      .set(ownerAuth())
      .set(branch())
      .send({
        branchId: clinic.branch.id,
        customerId: clinic.customer.id,
        startsAt,
        services: [
          { serviceId: clinic.quickService.id, staffProfileId: clinic.practitioner.staffProfileId },
        ],
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const requirements = async (appointmentId: string): Promise<RequirementsBody> =>
    (
      await http(app)
        .get(`/api/v1/appointments/${appointmentId}/consent-requirements`)
        .set(ownerAuth())
        .set(branch())
        .expect(200)
    ).body as RequirementsBody;

  async function sign(
    appointmentId: string,
    item: RequirementItem,
    extra: Record<string, unknown> = {},
  ) {
    if (item.document === null) throw new Error('İmzalanacak belge yok');
    return http(app)
      .post(`/api/v1/appointments/${appointmentId}/consent-signatures`)
      .set(ownerAuth())
      .set(branch())
      .send({
        kind: item.kind,
        documentId: item.document.documentId,
        textSha256: item.document.sha256,
        signerName: 'Ayşe Yılmaz',
        signerRelation: 'self',
        signaturePng: await signaturePng(),
        ...extra,
      });
  }

  const setStatus = (appointmentId: string, body: Record<string, unknown>) =>
    http(app)
      .post(`/api/v1/appointments/${appointmentId}/status`)
      .set(ownerAuth())
      .set(branch())
      .send(body);

  // -------------------------------------------------------------------------
  describe('şablonlar', () => {
    it('taslak → yayın → sürüm; yayınlanmış gövde veritabanında da değiştirilemez', async () => {
      const template = await createTemplate();
      expect(template.active).toMatchObject({ version: 1, body: TREATMENT_BODY });
      expect(template.active?.sha256).toBe(
        createHash('sha256').update(TREATMENT_BODY).digest('hex'),
      );
      expect(template.draft).toBeNull();

      await http(app)
        .put(`/api/v1/consent-templates/${template.id}/draft`)
        .set(ownerAuth())
        .send({ body: 'İkinci sürüm' })
        .expect(200);
      const second = (
        await http(app)
          .post(`/api/v1/consent-templates/${template.id}/publish`)
          .set(ownerAuth())
          .expect(200)
      ).body as TemplateBody;
      expect(second.active).toMatchObject({ version: 2, body: 'İkinci sürüm' });

      await expect(
        database.ownerPool.query(`update consent_template_versions set body = 'x' where id = $1`, [
          template.active?.id,
        ]),
      ).rejects.toThrow(/değiştirilemez/);
    });

    it('arşivlenmiş şablon hizmete bağlanamaz ve randevuda istenmez', async () => {
      const template = await createTemplate();
      await linkToService([template.id]);
      await http(app)
        .post(`/api/v1/consent-templates/${template.id}/archive`)
        .set(ownerAuth())
        .expect(200);

      const denied = await http(app)
        .put(`/api/v1/services/${clinic.service.id}/consent-templates`)
        .set(ownerAuth())
        .send({ templateIds: [template.id] });
      expect(denied.status).toBe(400);

      const appointmentId = await createAppointment();
      expect((await requirements(appointmentId)).items).toHaveLength(0);
    });

    it('uygulayıcı şablon metnini değiştiremez (consent:manage yok)', async () => {
      const res = await http(app)
        .post('/api/v1/consent-templates')
        .set(auth(clinic.practitioner.tokens))
        .send({ name: 'x', body: 'y' });
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('gereksinim ve imza', () => {
    it('KVKK + işlem onamı eksik görünür; imzalanınca karşılanır ve PDF üretilir', async () => {
      await publishConsent(
        app,
        clinic.owner.tokens,
        'KVKK aydınlatma metni. İşlenen veriler: ad, telefon.',
      );
      const template = await createTemplate();
      await linkToService([template.id]);
      const appointmentId = await createAppointment();

      const before = await requirements(appointmentId);
      expect(before.customerName).toBe('Ayşe Yılmaz');
      expect(before.items.map((item) => [item.kind, item.satisfied])).toEqual([
        ['kvkk_explicit', false],
        ['treatment', false],
      ]);
      expect(before.missingCount).toBe(2);

      for (const item of before.items) {
        const res = await sign(appointmentId, item);
        expect(res.status).toBe(201);
        const summary = res.body as SignatureSummary;
        expect(summary.signerName).toBe('Ayşe Yılmaz');
        expect(summary.collectedBy?.id).toBe(clinic.owner.userId);
      }

      const after = await requirements(appointmentId);
      expect(after.missingCount).toBe(0);
      expect(after.items.every((item) => item.signatureId !== null)).toBe(true);

      const list = (
        await http(app)
          .get(`/api/v1/customers/${clinic.customer.id}/consent-signatures`)
          .set(ownerAuth())
          .expect(200)
      ).body as SignatureSummary[];
      expect(list).toHaveLength(2);

      const treatment = list.find((row) => row.kind === 'treatment');
      if (treatment === undefined) throw new Error('İşlem onamı listede yok');
      const detail = (
        await http(app)
          .get(`/api/v1/consent-signatures/${treatment.id}`)
          .set(ownerAuth())
          .expect(200)
      ).body as { text: string; textSha256: string };
      expect(detail.text).toBe(TREATMENT_BODY);

      // PDF gerçekten üretildi, depoda duruyor ve hash'i satırdakiyle aynı.
      const { rows } = await database.ownerPool.query<{ pdf_key: string }>(
        'select pdf_key from consent_signatures where id = $1',
        [treatment.id],
      );
      const pdf = await storage.get(rows[0]?.pdf_key ?? '');
      expect(pdf?.subarray(0, 5).toString()).toBe('%PDF-');
      expect(
        createHash('sha256')
          .update(pdf ?? Buffer.alloc(0))
          .digest('hex'),
      ).toBe(treatment.pdfSha256);

      // PDF erişimi KVKK m.6 kaydına düşer.
      await http(app)
        .get(`/api/v1/consent-signatures/${treatment.id}/pdf-url`)
        .set(ownerAuth())
        .expect(200);
      const log = await database.ownerPool.query<{ resource_type: string }>(
        `select resource_type from customer_record_access_log where resource_id = $1`,
        [treatment.id],
      );
      expect(log.rows.map((row) => row.resource_type)).toEqual(['consent']);
    });

    it('online kabulü olan hastada KVKK zaten karşılanmış sayılır', async () => {
      await publishConsent(app, clinic.owner.tokens);
      const { rows } = await database.ownerPool.query<{ id: string; sha256: string; body: string }>(
        'select id, sha256, body from consent_documents where status = $1',
        ['published'],
      );
      const document = rows[0];
      await database.ownerPool.query(
        `insert into booking_consent_acceptances
           (tenant_id, booking_site_id, customer_id, kind, text_body, text_sha256, consent_document_id)
         select $1, bs.id, $2, 'kvkk_explicit', $3, $4, $5 from booking_sites bs where bs.tenant_id = $1`,
        [clinic.tenant.id, clinic.customer.id, document?.body, document?.sha256, document?.id],
      );

      const appointmentId = await createAppointment();
      const body = await requirements(appointmentId);
      expect(body.items).toEqual([
        expect.objectContaining({ kind: 'kvkk_explicit', satisfied: true, signatureId: null }),
      ]);
    });

    it('metin imza sırasında yeniden yayınlandıysa CONSENT_TEXT_CHANGED', async () => {
      const template = await createTemplate();
      await linkToService([template.id]);
      const appointmentId = await createAppointment();
      const [item] = (await requirements(appointmentId)).items;
      if (item === undefined) throw new Error('gereksinim yok');

      await http(app)
        .put(`/api/v1/consent-templates/${template.id}/draft`)
        .set(ownerAuth())
        .send({ body: 'Güncellenmiş metin' })
        .expect(200);
      await http(app)
        .post(`/api/v1/consent-templates/${template.id}/publish`)
        .set(ownerAuth())
        .expect(200);

      const res = await sign(appointmentId, item);
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONSENT_TEXT_CHANGED');
    });

    it('boş imza ve eksik veli adı reddedilir; aynı onam iki kez alınamaz', async () => {
      const template = await createTemplate();
      await linkToService([template.id]);
      const appointmentId = await createAppointment();
      const [item] = (await requirements(appointmentId)).items;
      if (item === undefined) throw new Error('gereksinim yok');

      expect((await sign(appointmentId, item, { signaturePng: await blankPng() })).status).toBe(
        400,
      );
      expect((await sign(appointmentId, item, { signerRelation: 'guardian' })).status).toBe(400);

      expect(
        (
          await sign(appointmentId, item, {
            signerRelation: 'guardian',
            guardianOfName: 'Ece Yılmaz',
          })
        ).status,
      ).toBe(201);
      const again = await sign(appointmentId, item);
      expect(again.status).toBe(409);
    });

    it('imza kaydı değiştirilemez ve silinemez', async () => {
      const template = await createTemplate();
      await linkToService([template.id]);
      const appointmentId = await createAppointment();
      const [item] = (await requirements(appointmentId)).items;
      if (item === undefined) throw new Error('gereksinim yok');
      const id = ((await sign(appointmentId, item)).body as SignatureSummary).id;

      await expect(
        database.ownerPool.query(`update consent_signatures set signer_name = 'x' where id = $1`, [
          id,
        ]),
      ).rejects.toThrow();
      await expect(
        database.ownerPool.query('delete from consent_signatures where id = $1', [id]),
      ).rejects.toThrow();
    });

    it('validity_days: süre içindeki imza sonraki randevuda da geçerli; null ise her randevuda yeniden', async () => {
      const yearly = await createTemplate({ name: 'Lazer paketi onamı', validityDays: 365 });
      const perVisit = await createTemplate({ name: 'Her seans onamı', validityDays: null });
      await linkToService([yearly.id, perVisit.id]);

      const first = await createAppointment(at('10:00'));
      for (const item of (await requirements(first)).items) {
        expect((await sign(first, item)).status).toBe(201);
      }

      const second = await createAppointment(at('14:00'));
      const items = (await requirements(second)).items;
      expect(items.find((item) => item.templateId === yearly.id)?.satisfied).toBe(true);
      expect(items.find((item) => item.templateId === perVisit.id)?.satisfied).toBe(false);
    });

    it('takvim rozetleri toplu döner', async () => {
      const template = await createTemplate();
      await linkToService([template.id]);
      const missing = await createAppointment(at('10:00'));
      const plain = await http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId: clinic.customer.id,
          startsAt: at('13:00'),
          services: [
            { serviceId: clinic.service.id, staffProfileId: clinic.practitioner.staffProfileId },
          ],
        })
        .expect(201);
      const plainId = (plain.body as { id: string }).id;

      const res = await http(app)
        .get('/api/v1/consent-statuses')
        .query({ ids: `${missing},${plainId}` })
        .set(ownerAuth())
        .expect(200);
      expect(res.body).toEqual(
        expect.arrayContaining([
          { appointmentId: missing, status: 'missing' },
          { appointmentId: plainId, status: 'none' },
        ]),
      );
    });

    it('randevusuz KVKK imzası müşteri üzerinden alınır; işlem onamı alınamaz', async () => {
      await publishConsent(app, clinic.owner.tokens);
      const req = (
        await http(app)
          .get(`/api/v1/customers/${clinic.customer.id}/consent-requirements`)
          .set(ownerAuth())
          .expect(200)
      ).body as RequirementsBody;
      const [item] = req.items;
      if (item?.document == null) throw new Error('KVKK belgesi yok');

      const res = await http(app)
        .post(`/api/v1/customers/${clinic.customer.id}/consent-signatures`)
        .set(ownerAuth())
        .set(branch())
        .send({
          kind: 'kvkk_explicit',
          documentId: item.document.documentId,
          textSha256: item.document.sha256,
          signerName: 'Ayşe Yılmaz',
          signerRelation: 'self',
          signaturePng: await signaturePng(),
        });
      expect(res.status).toBe(201);

      const appointmentId = await createAppointment();
      expect((await requirements(appointmentId)).items[0]).toMatchObject({
        kind: 'kvkk_explicit',
        satisfied: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('durum geçişi (yumuşak uyarı)', () => {
    async function toArrived(appointmentId: string) {
      for (const status of ['confirmed', 'arrived']) {
        await setStatus(appointmentId, { status }).expect(200);
      }
    }

    it('işlem onamı eksikse gerekçe ister; gerekçeyle geçer ve geçmişe yazar', async () => {
      const template = await createTemplate();
      await linkToService([template.id]);
      const appointmentId = await createAppointment();
      await toArrived(appointmentId);

      const blocked = await setStatus(appointmentId, { status: 'in_progress' });
      expect(blocked.status).toBe(409);
      expect((blocked.body as Problem).code).toBe('CONSENT_MISSING');
      expect((blocked.body as Problem).missing?.map((item) => item.title)).toEqual([
        'Botoks onamı',
      ]);

      await setStatus(appointmentId, {
        status: 'in_progress',
        consentOverrideReason: 'Hasta imzayı kağıda attı, sonra taranacak.',
      }).expect(200);
      // Gerekçe bir kez yeter: tamamlamada yeniden sorulmaz.
      await setStatus(appointmentId, { status: 'completed' }).expect(200);

      const { rows } = await database.ownerPool.query<{ reason: string }>(
        `select reason from appointment_history where appointment_id = $1 and action = 'consent_override'`,
        [appointmentId],
      );
      expect(rows.map((row) => row.reason)).toEqual(['Hasta imzayı kağıda attı, sonra taranacak.']);
    });

    it('yalnız KVKK eksikse geçiş durmaz', async () => {
      await publishConsent(app, clinic.owner.tokens);
      const appointmentId = await createAppointment();
      await toArrived(appointmentId);
      await setStatus(appointmentId, { status: 'in_progress' }).expect(200);
    });

    it('işlem onamı imzalanmışsa gerekçe sorulmaz', async () => {
      const template = await createTemplate();
      await linkToService([template.id]);
      const appointmentId = await createAppointment();
      const [item] = (await requirements(appointmentId)).items;
      if (item === undefined) throw new Error('gereksinim yok');
      expect((await sign(appointmentId, item)).status).toBe(201);

      await toArrived(appointmentId);
      await setStatus(appointmentId, { status: 'in_progress' }).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  it('kiracı izolasyonu: başka kiracının imzası görünmez', async () => {
    const template = await createTemplate();
    await linkToService([template.id]);
    const appointmentId = await createAppointment();
    const [item] = (await requirements(appointmentId)).items;
    if (item === undefined) throw new Error('gereksinim yok');
    const id = ((await sign(appointmentId, item)).body as SignatureSummary).id;

    const other = await setupClinic(app, { slug: 'baska-klinik' });
    const res = await http(app)
      .get(`/api/v1/consent-signatures/${id}`)
      .set(auth(other.owner.tokens));
    expect(res.status).toBe(404);
  });
});
