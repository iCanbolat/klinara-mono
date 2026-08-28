import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { NotificationDispatcherService } from '../../src/modules/notifications/notification-dispatcher.service';
import { NotificationSenderWorker } from '../../src/modules/notifications/notification-sender.worker';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';
import { GraphMock, graphError } from '../helpers/whatsapp';

interface Problem {
  code: string;
  status: number;
}

interface AccountBody {
  wabaId: string;
  status: string;
  accessTokenMasked: string;
  hasAppSecret: boolean;
  lastVerifiedAt: string | null;
}

interface MessageBody {
  status: string;
  errorCode: string | null;
  channel: string;
}

const TOKEN = 'EAAG-cok-gizli-erisim-tokeni-a91f';

describe('WhatsApp Cloud API adapter (Batch 8.2)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  const graph = new GraphMock();

  beforeAll(async () => {
    database = await startTestDatabase();
    const baseUrl = await graph.start();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        // Test edilen kod üretimdekiyle AYNI; yalnız karşı taraf mock.
        WHATSAPP_API_BASE_URL: baseUrl,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await graph.stop();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    graph.reset();
    clinic = await setupClinic(app);
  });

  const ownerAuth = () => auth(clinic.owner.tokens);

  const configure = (overrides: Record<string, unknown> = {}) =>
    http(app)
      .put('/api/v1/integrations/whatsapp')
      .set(ownerAuth())
      .send({
        wabaId: '102290129340398',
        phoneNumberId: '106540352242922',
        businessPhone: '+905321112233',
        accessToken: TOKEN,
        appSecret: 'webhook-imza-sirri',
        ...overrides,
      });

  const enqueueWhatsApp = () =>
    app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
      app.get(NotificationDispatcherService).enqueue(tx, clinic.tenant.id, {
        event: 'appointment_reminder',
        customerId: clinic.customer.id,
        branchId: clinic.branch.id,
        channels: ['whatsapp'],
        variables: {
          customerName: 'Ayşe Yılmaz',
          branchName: 'Merkez',
          appointmentAt: '7 Eylül 14:00',
          serviceName: 'Lazer',
        },
      }),
    );

  const runWorker = (messageId: string) =>
    app.get(NotificationSenderWorker).handle({ tenantId: clinic.tenant.id, messageId });

  const lastMessage = async (): Promise<MessageBody> => {
    const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
    const rows = (listed.body as { data: MessageBody[] }).data;
    const row = rows[0];
    if (row === undefined) throw new Error('mesaj kaydı yok');
    return row;
  };

  /** Kiracıya WhatsApp şablonu tanımlar (template adı + konumsal eşleme). */
  const defineTemplate = () =>
    http(app)
      .put('/api/v1/notification-templates')
      .set(ownerAuth())
      .send({
        event: 'appointment_reminder',
        channel: 'whatsapp',
        body: '{{customerName}} — {{appointmentAt}}',
        whatsappTemplateName: 'randevu_hatirlatma',
        whatsappTemplateLanguage: 'tr',
        whatsappVariables: ['customerName', 'appointmentAt'],
      });

  // -------------------------------------------------------------------------
  describe('kimlik bilgileri', () => {
    it('token şifreli saklanır, yanıtta yalnız MASKESİ döner', async () => {
      const created = await configure().expect(200);
      const body = created.body as AccountBody;

      expect(body.accessTokenMasked).toBe('••••••••a91f');
      expect(JSON.stringify(body)).not.toContain(TOKEN);
      expect(body.hasAppSecret).toBe(true);
      expect(body.status).toBe('unconfigured');

      const raw = await database.ownerPool.query<{ token: string; secret: string }>(
        'select access_token_encrypted as token, app_secret_encrypted as secret from whatsapp_accounts',
      );
      expect(raw.rows[0]?.token).not.toContain(TOKEN);
      // `<keyId>:<iv>:<tag>:<ciphertext>` — anahtar rotasyonuna hazır biçim.
      expect(raw.rows[0]?.token.split(':')).toHaveLength(4);
      expect(raw.rows[0]?.secret).not.toContain('webhook-imza-sirri');
    });

    it('doğrulama template listesini çeker ve hesabı `active` yapar', async () => {
      await configure().expect(200);
      const verified = await http(app)
        .post('/api/v1/integrations/whatsapp/verify')
        .set(ownerAuth())
        .expect(200);

      expect(verified.body).toMatchObject({ ok: true, templateCount: 1 });

      const account = await http(app)
        .get('/api/v1/integrations/whatsapp')
        .set(ownerAuth())
        .expect(200);
      expect((account.body as AccountBody).status).toBe('active');
      expect((account.body as AccountBody).lastVerifiedAt).not.toBeNull();

      const templates = await http(app)
        .get('/api/v1/integrations/whatsapp/templates')
        .set(ownerAuth())
        .expect(200);
      expect(templates.body).toHaveLength(1);
      expect(templates.body).toMatchObject([
        { name: 'randevu_hatirlatma', status: 'approved', bodyVariableCount: 2 },
      ]);
    });

    it('geçersiz token doğrulamada hesabı `error` durumuna düşürür', async () => {
      await configure().expect(200);
      graph.queue(graphError(401, 190, 'Invalid OAuth access token'));

      const verified = await http(app)
        .post('/api/v1/integrations/whatsapp/verify')
        .set(ownerAuth())
        .expect(200);
      expect((verified.body as { ok: boolean }).ok).toBe(false);

      const account = await http(app)
        .get('/api/v1/integrations/whatsapp')
        .set(ownerAuth())
        .expect(200);
      expect((account.body as AccountBody).status).toBe('error');
    });

    it('kimlik bilgisi güncellemesi hesabı yeniden DOĞRULANMAMIŞ yapar', async () => {
      await configure().expect(200);
      await http(app).post('/api/v1/integrations/whatsapp/verify').set(ownerAuth()).expect(200);

      await configure({ accessToken: 'EAAG-yeni-token-b22e' }).expect(200);
      const account = await http(app)
        .get('/api/v1/integrations/whatsapp')
        .set(ownerAuth())
        .expect(200);
      expect((account.body as AccountBody).status).toBe('unconfigured');
    });

    it('yetkisiz rol entegrasyonu okuyamaz', async () => {
      await configure().expect(200);
      const forbidden = await http(app)
        .get('/api/v1/integrations/whatsapp')
        .set(auth(clinic.practitioner.tokens))
        .expect(403);
      expect((forbidden.body as Problem).code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  describe('test gönderimi ve hata eşlemesi', () => {
    beforeEach(async () => {
      await configure().expect(200);
    });

    it('onaylı template ile gönderir ve sağlayıcı kimliğini döner', async () => {
      const sent = await http(app)
        .post('/api/v1/integrations/whatsapp/test')
        .set(ownerAuth())
        .send({ to: '+905321234567', templateName: 'randevu_hatirlatma' })
        .expect(200);

      expect(sent.body).toMatchObject({ accepted: true, providerMessageId: 'wamid.TEST' });

      const request = graph.requests.at(-1);
      expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
      expect(request?.body).toMatchObject({
        messaging_product: 'whatsapp',
        to: '+905321234567',
        type: 'template',
      });
    });

    // Sınıflama tablo-testi: bir kodun yanlış sınıfa düşmesi ya sonsuz yeniden
    // deneme ya da kaybolan mesaj demek.
    const cases: { code: number; status: number; expected: string; httpStatus: number }[] = [
      { code: 190, status: 401, expected: 'WHATSAPP_NOT_CONFIGURED', httpStatus: 422 },
      { code: 131026, status: 400, expected: 'WHATSAPP_INVALID_RECIPIENT', httpStatus: 422 },
      { code: 131047, status: 400, expected: 'WHATSAPP_WINDOW_CLOSED', httpStatus: 422 },
      { code: 132001, status: 400, expected: 'WHATSAPP_TEMPLATE_NOT_APPROVED', httpStatus: 422 },
      { code: 130429, status: 429, expected: 'WHATSAPP_RATE_LIMITED', httpStatus: 503 },
    ];

    for (const testCase of cases) {
      it(`Meta ${testCase.code} → ${testCase.expected}`, async () => {
        graph.queue(graphError(testCase.status, testCase.code));
        const rejected = await http(app)
          .post('/api/v1/integrations/whatsapp/test')
          .set(ownerAuth())
          .send({ to: '+905321234567', templateName: 'randevu_hatirlatma' })
          .expect(testCase.httpStatus);
        expect((rejected.body as Problem).code).toBe(testCase.expected);
      });
    }

    it('geçersiz numara Meta’ya çağrı YAPILMADAN reddedilir', async () => {
      // Kısa/biçimsiz değer DTO doğrulamasına takılır (400); biçimi doğru ama
      // geçersiz numara servis katmanında normalize edilemez (422). İkisi ayrı
      // katman, ikisinin de sağlayıcıya gitmemesi gerekiyor.
      await http(app)
        .post('/api/v1/integrations/whatsapp/test')
        .set(ownerAuth())
        .send({ to: 'abc', templateName: 'randevu_hatirlatma' })
        .expect(400);

      const rejected = await http(app)
        .post('/api/v1/integrations/whatsapp/test')
        .set(ownerAuth())
        .send({ to: '+90000000000', templateName: 'randevu_hatirlatma' })
        .expect(422);
      expect((rejected.body as Problem).code).toBe('VALIDATION_FAILED');
      expect(graph.requests).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('bildirim çekirdeğinden gönderim', () => {
    it('template parametrelerini ŞABLONDAKİ SIRAYLA gönderir', async () => {
      await configure().expect(200);
      await defineTemplate().expect(200);

      const queued = await enqueueWhatsApp();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      const request = graph.requests.at(-1);
      const template = (request?.body as { template: { components: unknown[]; name: string } })
        .template;
      expect(template.name).toBe('randevu_hatirlatma');
      expect(template.components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ayşe Yılmaz' },
            { type: 'text', text: '7 Eylül 14:00' },
          ],
        },
      ]);

      expect((await lastMessage()).status).toBe('sent');
    });

    it('hesap yapılandırılmamışsa KALICI hata — yeniden denenmez', async () => {
      const queued = await enqueueWhatsApp();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      await expect(runWorker(queued.messageId)).resolves.toBeUndefined();

      const row = await lastMessage();
      expect(row.status).toBe('failed');
      expect(row.errorCode).toBe('WHATSAPP_NOT_CONFIGURED');
      expect(graph.requests).toHaveLength(0);
    });

    it('template tanımsızken 24 saat penceresi kapalıysa gönderim REDDEDİLİR', async () => {
      await configure().expect(200);
      // Şablon satırı yok → template adı yok → serbest metin denenir.
      const queued = await enqueueWhatsApp();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      const row = await lastMessage();
      expect(row.status).toBe('failed');
      expect(row.errorCode).toBe('WHATSAPP_WINDOW_CLOSED');
      // Meta'ya HİÇ çağrı yapılmadı: kuralı kendi kodumuz uyguladı.
      expect(graph.requests).toHaveLength(0);
    });

    it('müşteri son 24 saatte yazdıysa serbest metin gider', async () => {
      await configure().expect(200);
      await database.ownerPool.query(
        `insert into whatsapp_contact_windows (tenant_id, phone, last_inbound_at)
         values ($1, '+905321234567', now())`,
        [clinic.tenant.id],
      );

      const queued = await enqueueWhatsApp();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      expect(graph.requests.at(-1)?.body).toMatchObject({ type: 'text' });
      expect((await lastMessage()).status).toBe('sent');
    });

    it('GEÇİCİ hatada mesaj `queued`a döner ve iş kuyruğa fırlatılır', async () => {
      await configure().expect(200);
      await defineTemplate().expect(200);
      graph.queue(graphError(429, 130429, 'rate limit'));

      const queued = await enqueueWhatsApp();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      // Fırlatıyor: pg-boss üstel geri çekilmeyle yeniden deneyecek.
      await expect(runWorker(queued.messageId)).rejects.toThrow();

      const row = await lastMessage();
      expect(row.status).toBe('queued');
      expect(row.errorCode).toBe('WHATSAPP_RATE_LIMITED');
    });
  });
});
