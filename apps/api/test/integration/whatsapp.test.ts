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
          branchAddress: 'Bağdat Cad. No:1, Kadıköy',
          branchMapsQuery: 'Merkez%20Ba%C4%9Fdat',
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

  /**
   * Hesabı kaydeder VE doğrular. Dispatcher doğrulanmamış hesapta WhatsApp'ı
   * atlıyor; gönderim testleri doğrulanmış hesap istiyor.
   * Doğrulamanın Meta çağrısı sayaçta kalmasın diye mock sıfırlanıyor.
   */
  const activate = async () => {
    await configure().expect(200);
    const verified = await http(app)
      .post('/api/v1/integrations/whatsapp/verify')
      .set(ownerAuth())
      .expect(200);
    expect((verified.body as { ok: boolean }).ok).toBe(true);
    graph.reset();
  };

  /** Otomatik cevap: standart template'i OLMAYAN, serbest metinli olay. */
  const enqueueAutoReply = () =>
    app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
      app.get(NotificationDispatcherService).enqueue(tx, clinic.tenant.id, {
        event: 'auto_reply',
        customerId: clinic.customer.id,
        channels: ['whatsapp'],
        variables: { message: 'Randevunuz onaylandı.' },
      }),
    );

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
      // Abonelik olmadan Meta bu WABA'nın webhook'larını hiç göndermez.
      expect(
        graph.requests.some(
          (request) => request.method === 'POST' && request.url.endsWith('/subscribed_apps'),
        ),
      ).toBe(true);

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
        {
          name: 'randevu_hatirlatma',
          status: 'approved',
          bodyVariableCount: 2,
          // Gövde de yansımaya yazılır — sohbet ekranı önizlemesi buradan okur.
          bodyText: 'Sayın {{1}}, {{2}} randevunuzu hatırlatırız.',
        },
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

    it('Meta hata metnindeki ham token yanıta ve `last_error`a SIZMAZ', async () => {
      await configure().expect(200);
      graph.queue(graphError(400, 190, `Malformed access token ${TOKEN}`));

      const verified = await http(app)
        .post('/api/v1/integrations/whatsapp/verify')
        .set(ownerAuth())
        .expect(200);
      const account = await http(app)
        .get('/api/v1/integrations/whatsapp')
        .set(ownerAuth())
        .expect(200);

      const error = (verified.body as { error: string }).error;
      const lastError = (account.body as { lastError: string }).lastError;
      expect(error).not.toContain(TOKEN);
      expect(lastError).not.toContain(TOKEN);
      expect(lastError).toContain('a91f');
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

    it('app secret verilmeyen güncelleme KAYITLI secret’ı korur', async () => {
      await configure().expect(200);

      const updated = await http(app)
        .put('/api/v1/integrations/whatsapp')
        .set(ownerAuth())
        .send({
          wabaId: '102290129340398',
          phoneNumberId: '106540352242922',
          accessToken: 'EAAG-yeni-token-b22e',
        })
        .expect(200);

      // Eskiden `null` yazılıyordu: webhook imzası doğrulanamaz, gelen kutusu boş kalırdı.
      expect((updated.body as AccountBody).hasAppSecret).toBe(true);
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
      await activate();
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

    it('şablon eşlemesi yoksa Klinara’nın STANDART template’i gider', async () => {
      await activate();

      const queued = await enqueueWhatsApp();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      const template = (
        graph.requests.at(-1)?.body as { template: { components: unknown[]; name: string } }
      ).template;
      expect(template.name).toBe('klinara_randevu_hatirlatma_v3');
      // Sıra standart tanımdaki `variables`tan: ad, zaman, hizmet, şube, adres.
      expect(template.components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ayşe Yılmaz' },
            { type: 'text', text: '7 Eylül 14:00' },
            { type: 'text', text: 'Lazer' },
            { type: 'text', text: 'Merkez' },
            { type: 'text', text: 'Bağdat Cad. No:1, Kadıköy' },
          ],
        },
        // Haritada aç: quick-reply'lardan (2) sonra gelen URL butonu, adresten üretilen ek.
        {
          type: 'button',
          sub_type: 'url',
          index: '2',
          parameters: [{ type: 'text', text: 'Merkez%20Ba%C4%9Fdat' }],
        },
      ]);
      expect((await lastMessage()).status).toBe('sent');
    });

    it('template ONAY BEKLİYORSA WhatsApp atlanır ve mesaj yazılmaz', async () => {
      await activate();
      // Meta onay bekleyen template'le gönderime izin vermiyor (#132001);
      // denenirse müşteriye hiçbir şey gitmezdi.
      await database.ownerPool.query(
        `insert into whatsapp_templates (tenant_id, name, language, status)
         values ($1, 'klinara_randevu_hatirlatma_v3', 'tr', 'pending')`,
        [clinic.tenant.id],
      );

      const queued = await app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
        app.get(NotificationDispatcherService).enqueue(tx, clinic.tenant.id, {
          event: 'appointment_reminder',
          customerId: clinic.customer.id,
          branchId: clinic.branch.id,
          channels: ['whatsapp'],
          variables: {
            customerName: 'Ayşe Yılmaz',
            branchName: 'Merkez',
            branchAddress: 'Bağdat Cad. No:1, Kadıköy',
          branchMapsQuery: 'Merkez%20Ba%C4%9Fdat',
            appointmentAt: '7 Eylül 14:00',
            serviceName: 'Lazer',
          },
        }),
      );

      expect(queued.status).toBe('skipped');
    });

    it('hesap gönderimden önce kaldırılırsa KALICI hata — yeniden denenmez', async () => {
      await activate();
      const queued = await enqueueWhatsApp();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await database.ownerPool.query('delete from whatsapp_accounts where tenant_id = $1', [
        clinic.tenant.id,
      ]);

      await expect(runWorker(queued.messageId)).resolves.toBeUndefined();

      const row = await lastMessage();
      expect(row.status).toBe('failed');
      expect(row.errorCode).toBe('WHATSAPP_NOT_CONFIGURED');
      expect(graph.requests).toHaveLength(0);
    });

    it('serbest metin 24 saat penceresi kapalıysa REDDEDİLİR', async () => {
      await activate();
      // Otomatik cevabın standart template'i yok → serbest metin denenir.
      const queued = await enqueueAutoReply();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      const row = await lastMessage();
      expect(row.status).toBe('failed');
      expect(row.errorCode).toBe('WHATSAPP_WINDOW_CLOSED');
      // Meta'ya HİÇ çağrı yapılmadı: kuralı kendi kodumuz uyguladı.
      expect(graph.requests).toHaveLength(0);
    });

    it('müşteri son 24 saatte yazdıysa serbest metin gider', async () => {
      await activate();
      await database.ownerPool.query(
        `insert into whatsapp_contact_windows (tenant_id, phone, last_inbound_at)
         values ($1, '+905321234567', now())`,
        [clinic.tenant.id],
      );

      const queued = await enqueueAutoReply();
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      expect(graph.requests.at(-1)?.body).toMatchObject({ type: 'text' });
      expect((await lastMessage()).status).toBe('sent');
    });

    it('GEÇİCİ hatada mesaj `queued`a döner ve iş kuyruğa fırlatılır', async () => {
      await activate();
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

  // -------------------------------------------------------------------------
  describe('standart template seti (provision)', () => {
    interface ProvisionBody {
      results: { name: string; outcome: string; status: string | null; error: string | null }[];
      created: number;
      failed: number;
    }

    const provision = () =>
      http(app).post('/api/v1/integrations/whatsapp/templates/provision').set(ownerAuth());

    it('eksik template’leri Meta’da oluşturur ve yansımayı tazeler', async () => {
      await configure().expect(200);

      const result = await provision().expect(200);
      const body = result.body as ProvisionBody;
      expect(body.failed).toBe(0);
      expect(body.created).toBe(body.results.length);
      expect(body.results.map((row) => row.name)).toContain('klinara_randevu_hatirlatma_v3');
      // Kaldırılan şablonlar yeniden oluşturulmaz.
      expect(body.results.map((row) => row.name)).not.toContain('klinara_gorusme_baslat');
      expect(body.results.map((row) => row.name)).not.toContain('klinara_paket_sure_bilgisi');

      const creates = graph.requests.filter(
        (request) => request.method === 'POST' && request.url.includes('message_templates'),
      );
      expect(creates).toHaveLength(body.created);
      // Yol: sürüm + WABA — telefon numarası kimliği DEĞİL.
      expect(creates[0]?.url).toMatch(/^\/v\d+\.\d+\/102290129340398\/message_templates$/);

      // Hatırlatma: konumsal gövde, örnek değerler ve iki hızlı yanıt butonu.
      const reminder = creates.find(
        (request) => request.body['name'] === 'klinara_randevu_hatirlatma_v3',
      )?.body as { category: string; language: string; components: Record<string, unknown>[] };
      expect(reminder.category).toBe('UTILITY');
      expect(reminder.language).toBe('tr');
      const bodyComponent = reminder.components.find((c) => c['type'] === 'BODY') as {
        text: string;
        example: { body_text: string[][] };
      };
      expect(bodyComponent.text).toContain('{{1}}');
      expect(bodyComponent.text).toContain('{{5}}');
      expect(bodyComponent.text).not.toContain('{{customerName}}');
      expect(bodyComponent.example.body_text[0]).toHaveLength(5);
      expect(reminder.components.find((c) => c['type'] === 'BUTTONS')).toEqual({
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Onaylıyorum' },
          { type: 'QUICK_REPLY', text: 'İptal etmek istiyorum' },
          {
            type: 'URL',
            text: 'Haritada aç',
            url: 'https://www.google.com/maps/search/?api=1&query={{1}}',
            example: ['https://www.google.com/maps/search/?api=1&query=Kadikoy'],
          },
        ],
      });

      // OTP: AUTHENTICATION biçimi — metni Meta üretir, kopyalama butonu var.
      const otp = creates.find((request) => request.body['name'] === 'booking_otp')?.body as {
        category: string;
        components: Record<string, unknown>[];
      };
      expect(otp.category).toBe('AUTHENTICATION');
      expect(otp.components).toContainEqual({
        type: 'BUTTONS',
        buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Kodu kopyala' }],
      });

      // Token HİÇBİR yanıtta yok.
      expect(JSON.stringify(result.body)).not.toContain(TOKEN);
    });

    it('Meta’da zaten olan template’e DOKUNMAZ (idempotent)', async () => {
      await configure().expect(200);
      graph.queue({
        status: 200,
        payload: {
          data: [
            {
              name: 'klinara_randevu_hatirlatma_v3',
              language: 'tr',
              category: 'UTILITY',
              status: 'APPROVED',
              components: [{ type: 'BODY', text: 'Merhaba {{1}}' }],
            },
          ],
        },
      });

      const body = (await provision().expect(200)).body as ProvisionBody;
      const reminder = body.results.find((row) => row.name === 'klinara_randevu_hatirlatma_v3');
      expect(reminder).toMatchObject({ outcome: 'exists', status: 'approved' });

      const created = graph.requests.filter(
        (request) =>
          request.method === 'POST' && request.body['name'] === 'klinara_randevu_hatirlatma_v3',
      );
      expect(created).toHaveLength(0);
    });

    it('tek template’in reddi ötekileri DURDURMAZ ve token hata metninden silinir', async () => {
      await configure().expect(200);
      graph.queue({ status: 200, payload: { data: [] } });
      graph.queue(graphError(400, 100, `Invalid parameter ${TOKEN}`));

      const body = (await provision().expect(200)).body as ProvisionBody;
      expect(body.failed).toBe(1);
      expect(body.created).toBe(body.results.length - 1);
      const failed = body.results.find((row) => row.outcome === 'failed');
      expect(failed?.error).toContain('Invalid parameter');
      expect(failed?.error).not.toContain(TOKEN);
    });

    it('hesap yoksa 422 WHATSAPP_NOT_CONFIGURED', async () => {
      const rejected = await provision().expect(422);
      expect((rejected.body as Problem).code).toBe('WHATSAPP_NOT_CONFIGURED');
    });

    it('`notification:manage` taşımayan rol çağıramaz', async () => {
      await configure().expect(200);
      await http(app)
        .post('/api/v1/integrations/whatsapp/templates/provision')
        .set(auth(clinic.practitioner.tokens))
        .expect(403);
    });
  });
});
