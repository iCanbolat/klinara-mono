import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { CONSENT_BODY, publishConsent, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface StateBody {
  active: { id: string; version: number; sha256: string; status: string; body: string } | null;
  draft: { id: string; version: number | null; status: string; body: string } | null;
}
interface VersionBody {
  version: number;
  sha256: string;
  status: string;
}
interface Problem {
  code: string;
}

/**
 * Faz 7 (daraltılmış) — TEK zorunlu KVKK onayı.
 *
 * Sınanan sözleşme: metin sürümlü ve yayınlandıktan sonra DEĞİŞMEZ, hash'i
 * sunucu üretir, kabul kanıtı gösterilen gövdeyi birebir saklar.
 */
describe('onam metni ve kabul kanıtı (Faz 7)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app, { slug: 'klinik-x' });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const state = () => http(app).get('/api/v1/consent-document').set(ownerAuth());

  it('yayında metin yokken active null döner', async () => {
    const res = await state().expect(200);
    expect(res.body as StateBody).toMatchObject({ active: null, draft: null });
  });

  it('taslak kaydedilir, hash SUNUCUDA hesaplanır ve ikinci kayıt AYNI taslağı günceller', async () => {
    await http(app)
      .put('/api/v1/consent-document/draft')
      .set(ownerAuth())
      .send({ body: 'İlk taslak' })
      .expect(200);
    const first = ((await state().expect(200)).body as StateBody).draft;
    expect(first).toMatchObject({ status: 'draft', body: 'İlk taslak', version: null });

    await http(app)
      .put('/api/v1/consent-document/draft')
      .set(ownerAuth())
      .send({ body: 'İkinci taslak' })
      .expect(200);
    const second = ((await state().expect(200)).body as StateBody).draft;
    // Aynı satır: site başına tek taslak (kısmî UNIQUE).
    expect(second?.id).toBe(first?.id);
    expect(second?.body).toBe('İkinci taslak');
  });

  it('yayın sürüm üretir; ikinci yayın v2 olur ve v1 arşive düşer', async () => {
    await publishConsent(app, clinic.owner.tokens, 'v1 metni');
    expect(((await state().expect(200)).body as StateBody).active).toMatchObject({
      version: 1,
      status: 'published',
      body: 'v1 metni',
    });

    await publishConsent(app, clinic.owner.tokens, 'v2 metni');
    const after = ((await state().expect(200)).body as StateBody).active;
    expect(after).toMatchObject({ version: 2, body: 'v2 metni' });

    const versions = (
      await http(app).get('/api/v1/consent-document/versions').set(ownerAuth()).expect(200)
    ).body as VersionBody[];
    expect(versions.map((row) => [row.version, row.status])).toEqual([
      [2, 'published'],
      [1, 'archived'],
    ]);
  });

  it('taslak yokken yayın reddedilir', async () => {
    await http(app).post('/api/v1/consent-document/publish').set(ownerAuth()).expect(409);
  });

  /**
   * Faz 7'nin bütün gerekçesi bu: yayınlanmış metin değiştirilebiliyorsa
   * "müşteri hangi metni onayladı" sorusu yıllar sonra cevaplanamaz.
   */
  it('KRİTİK: yayınlanmış metin DEĞİŞTİRİLEMEZ ve SİLİNEMEZ (trigger)', async () => {
    await publishConsent(app, clinic.owner.tokens);

    await expect(
      database.ownerPool.query(`update consent_documents set body = 'sahte' where version = 1`),
    ).rejects.toThrow(/değiştirilemez|restrict/i);
    await expect(
      database.ownerPool.query(`delete from consent_documents where version = 1`),
    ).rejects.toThrow(/silinemez|restrict/i);

    // Taslak ise serbestçe düzenlenebilir olmalı — aksi hâlde yazım akışı çalışmaz.
    await http(app)
      .put('/api/v1/consent-document/draft')
      .set(ownerAuth())
      .send({ body: 'Serbest taslak' })
      .expect(200);
  });

  it('yayınlanmış sürüm sha256’sı sunucunun hesabıyla tutuyor', async () => {
    await publishConsent(app, clinic.owner.tokens, CONSENT_BODY);
    const active = ((await state().expect(200)).body as StateBody).active;
    const { rows } = await database.ownerPool.query<{ h: string }>(
      `select encode(digest($1, 'sha256'), 'hex') as h`,
      [CONSENT_BODY],
    );
    expect(active?.sha256).toBe(rows[0]?.h);
  });

  it('kabul kanıtı ucu filtresiz çağrılamaz', async () => {
    await http(app).get('/api/v1/consent-acceptances').set(ownerAuth()).expect(400);
  });

  /**
   * `consent:read` ve `consent:manage` Faz 7'ye kadar dağıtılıyor ama hiçbir
   * kapıyı açmıyordu (10.3 bulgusu). Artık ayrımı bu test tutuyor.
   */
  it('uygulayıcı okur ama yayınlayamaz', async () => {
    const practitionerAuth = auth(clinic.practitioner.tokens);

    await http(app).get('/api/v1/consent-document').set(practitionerAuth).expect(200);
    const res = await http(app)
      .put('/api/v1/consent-document/draft')
      .set(practitionerAuth)
      .send({ body: 'olmaz' })
      .expect(403);
    expect((res.body as Problem).code).toBe('FORBIDDEN');
  });
});
