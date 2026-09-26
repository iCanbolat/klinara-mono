import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { NotificationDispatcherService } from '../../src/modules/notifications/notification-dispatcher.service';
import { NotificationSenderWorker } from '../../src/modules/notifications/notification-sender.worker';
import { MAIL_SENDER } from '../../src/lib/mail/mail.types';
import type { LogMailSender } from '../../src/lib/mail/mail.module';
import type { EnqueueInput } from '../../src/modules/notifications/notification-dispatcher.service';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';
import { GraphMock } from '../helpers/whatsapp';

interface Problem {
  code: string;
  status: number;
}

interface MessageBody {
  id: string;
  channel: string;
  event: string;
  status: string;
  to: string;
  body: string | null;
  errorCode: string | null;
  scheduledFor: string;
}

interface TemplateBody {
  id: string | null;
  event: string;
  channel: string;
  body: string;
  isDefault: boolean;
  variables: string[];
}

describe('bildirim çekirdeği (Batch 8.1)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let practitioner: { userId: string; tokens: Tokens };
  const graph = new GraphMock();

  beforeAll(async () => {
    database = await startTestDatabase();
    const baseUrl = await graph.start();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
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
    practitioner = clinic.practitioner;
    mail().sent.length = 0;
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const mail = () => app.get<LogMailSender>(MAIL_SENDER);
  /** Meta'ya giden mesaj gönderimleri (template eşitleme ve doğrulama hariç). */
  const sentToMeta = () => graph.requests.filter((request) => request.url.endsWith('/messages'));

  /** Dispatcher'ı istek bağlamı olmadan, kiracı context'i altında çağırır. */
  const enqueue = (input: EnqueueInput) =>
    app
      .get(TenantTxService)
      .runForTenant(clinic.tenant.id, (tx) =>
        app.get(NotificationDispatcherService).enqueue(tx, clinic.tenant.id, input),
      );

  const runWorker = (messageId: string) =>
    app.get(NotificationSenderWorker).handle({ tenantId: clinic.tenant.id, messageId });

  const reminder = (overrides: Partial<EnqueueInput> = {}): EnqueueInput => ({
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
    ...overrides,
  });

  /**
   * Kiracıya DOĞRULANMIŞ bir WhatsApp hesabı ekler. Dispatcher doğrulanmamış
   * hesapta WhatsApp'ı atlıyor; kanal seçimini sınayan testler bunu istiyor.
   * Token burada şifreli değil — bu yardımcıyla kurulan testler WhatsApp'a
   * GÖNDERMİYOR, yalnız kanal seçimine bakıyor. Gönderim için `activate`.
   */
  const activateWhatsApp = () =>
    database.ownerPool.query(
      `insert into whatsapp_accounts (tenant_id, waba_id, phone_number_id, access_token_encrypted, status)
       values ($1, 'waba-test', 'phone-test', 'sifreli-degil', 'active')`,
      [clinic.tenant.id],
    );

  /** Hesabı API üzerinden kaydeder ve doğrular: worker gerçekten gönderebilsin. */
  const activate = async () => {
    await http(app)
      .put('/api/v1/integrations/whatsapp')
      .set(ownerAuth())
      .send({
        wabaId: '102290129340398',
        phoneNumberId: '106540352242922',
        businessPhone: '+905321112233',
        accessToken: 'EAAG-cok-gizli-erisim-tokeni-a91f',
        appSecret: 'webhook-imza-sirri',
      })
      .expect(200);
    await http(app).post('/api/v1/integrations/whatsapp/verify').set(ownerAuth()).expect(200);
    graph.reset();
  };

  const setPreference = (body: Record<string, unknown>) =>
    http(app).put('/api/v1/notification-preferences').set(ownerAuth()).send(body);

  // -------------------------------------------------------------------------
  describe('gönderim akışı', () => {
    it('mesajı kuyruğa yazar, worker gönderir ve kayıt `sent` olur', async () => {
      await activate();
      const queued = await enqueue(reminder());
      expect(queued.status).toBe('queued');
      if (queued.status !== 'queued') return;

      await runWorker(queued.messageId);
      expect(sentToMeta()).toHaveLength(1);

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      const data = (listed.body as { data: MessageBody[] }).data;
      expect(data).toHaveLength(1);
      expect(data[0]?.status).toBe('sent');
      expect(data[0]?.channel).toBe('whatsapp');
      // Kayda standart template'in metni yazılır: müşterinin gördüğü metin.
      expect(data[0]?.body).toContain('Ayşe Yılmaz');
    });

    it('alıcı adresi yanıtta da veritabanında da MASKELİ durur', async () => {
      await activateWhatsApp();
      const queued = await enqueue(reminder());
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      const row = (listed.body as { data: MessageBody[] }).data[0];
      expect(row?.to).toMatch(/^\+90\*+\d{2}$/);

      // Ham numara HİÇBİR sütunda bulunmamalı: `message_log` yıllarca duran
      // bir tablo ve kişisel veriyi orada biriktirmek taşımak zorunda
      // olmadığımız bir yük.
      const raw = await database.ownerPool.query<{ hit: string }>(
        `select id::text as hit from message_log where to_masked like '%5321234567%'
            or coalesce(rendered_body, '') like '%5321234567%'`,
      );
      expect(raw.rows).toHaveLength(0);
    });

    it('WhatsApp hesabı doğrulanmamışsa mesaj YAZILMAZ', async () => {
      // Müşteriye giden tek kanal WhatsApp; hesabı olmayan kiracıda gönderilemeyecek
      // bir `failed` satırı üretmek yerine hiç yazılmıyor.
      const result = await enqueue(reminder());
      expect(result.status).toBe('skipped');

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      expect((listed.body as { data: MessageBody[] }).data).toHaveLength(0);
    });

    it('kuyruktan çıkmış bir mesajı worker YENİDEN göndermez', async () => {
      await activate();
      const queued = await enqueue(reminder());
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      await runWorker(queued.messageId);
      await runWorker(queued.messageId);

      expect(sentToMeta()).toHaveLength(1);
    });

    it('personele giden iç bildirim e-postayla gider', async () => {
      const queued = await enqueue({
        event: 'staff_internal',
        userId: clinic.owner.userId,
        branchId: clinic.branch.id,
        variables: { subject: 'Gönderilemeyen hatırlatma', message: 'Bir hatırlatma düştü.' },
      });
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      expect(mail().sent).toHaveLength(1);
      expect(mail().sent[0]?.subject).toBe('Gönderilemeyen hatırlatma');
    });

    it('müşteri olayında e-posta İSTENSE bile kanal listesinden düşer', async () => {
      // Klinik müşterisiyle yalnız WhatsApp üzerinden yazışır; kayıtlı eski
      // tercihler hâlâ e-posta taşıyabilir ve süzülmezse WhatsApp'ın önünü keserdi.
      await activateWhatsApp();
      const queued = await enqueue(reminder({ channels: ['email', 'whatsapp'] }));
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      expect(queued.channel).toBe('whatsapp');
      expect(mail().sent).toHaveLength(0);
    });

    it('adresi olmayan alıcı için mesaj kaydı HİÇ yazılmaz', async () => {
      await activateWhatsApp();
      const created = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth())
        .send({ fullName: 'Telefonsuz Müşteri' })
        .expect(201);

      const result = await enqueue(reminder({ customerId: (created.body as { id: string }).id }));
      expect(result.status).toBe('skipped');

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      expect((listed.body as { data: MessageBody[] }).data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('çift gönderim ve sessiz saatler', () => {
    beforeEach(() => activateWhatsApp());

    it('aynı `dedupeKey` ile ikinci mesaj YAZILAMAZ', async () => {
      const first = await enqueue(reminder({ dedupeKey: 'reminder:abc:24' }));
      expect(first.status).toBe('queued');

      const second = await enqueue(reminder({ dedupeKey: 'reminder:abc:24' }));
      expect(second.status).toBe('duplicate');

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      expect((listed.body as { data: MessageBody[] }).data).toHaveLength(1);
    });

    it('sessiz saatte üretilen mesaj SABAHA ertelenir', async () => {
      // 7 Eylül 23:30 İstanbul.
      const queued = await enqueue(
        reminder({ scheduledFor: new Date('2026-09-07T20:30:00Z') }),
      );
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      expect(queued.scheduledFor.toISOString()).toBe('2026-09-08T06:00:00.000Z');
    });

    it('randevu ONAYI ve İPTALİ sessiz saatte bile ANINDA gider', async () => {
      // 7 Eylül 23:30 İstanbul — müşteri online randevuyu gece alıyor.
      const at = new Date('2026-09-07T20:30:00Z');
      for (const event of ['appointment_confirmation', 'appointment_cancelled'] as const) {
        const queued = await enqueue(
          reminder({ event, scheduledFor: at, dedupeKey: `${event}:gece` }),
        );
        if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
        expect(queued.scheduledFor.toISOString()).toBe(at.toISOString());
      }
    });

    it('şube tercihindeki sessiz saat penceresi kiracı varsayılanını EZER', async () => {
      await setPreference({
        branchId: clinic.branch.id,
        event: 'appointment_reminder',
        channels: ['whatsapp'],
        quietHoursStart: '23:00',
        quietHoursEnd: '07:00',
      }).expect(200);

      // 22:00 İstanbul — kiracı varsayılanında (21:00) sessiz, şube
      // penceresinde (23:00) değil.
      const queued = await enqueue(reminder({ scheduledFor: new Date('2026-09-07T19:00:00Z') }));
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      expect(queued.scheduledFor.toISOString()).toBe('2026-09-07T19:00:00.000Z');
    });

    it('eşit başlangıç ve bitiş sessiz saati KAPATIR — gece üretilen mesaj ertelenmez', async () => {
      const saved = await setPreference({
        branchId: clinic.branch.id,
        event: 'appointment_reminder',
        channels: ['whatsapp'],
        quietHoursStart: '00:00',
        quietHoursEnd: '00:00',
      }).expect(200);
      expect((saved.body as { quietHoursEnabled: boolean }).quietHoursEnabled).toBe(false);

      // 23:30 İstanbul — varsayılan pencerede (21:00–09:00) sabaha kalırdı.
      const queued = await enqueue(reminder({ scheduledFor: new Date('2026-09-07T20:30:00Z') }));
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      expect(queued.scheduledFor.toISOString()).toBe('2026-09-07T20:30:00.000Z');

      const listed = await http(app)
        .get('/api/v1/notification-preferences')
        .set(ownerAuth())
        .expect(200);
      const rows = listed.body as {
        event: string;
        branchId: string | null;
        quietHoursEnabled: boolean;
      }[];
      // Kiracı varsayılanı hâlâ açık; kapatılan yalnız şube satırı.
      expect(
        rows.find((r) => r.event === 'appointment_reminder' && r.branchId === null)
          ?.quietHoursEnabled,
      ).toBe(true);
      expect(
        rows.find((r) => r.event === 'appointment_reminder' && r.branchId === clinic.branch.id)
          ?.quietHoursEnabled,
      ).toBe(false);
    });

    it('personele giden iç bildirim ERTELENMEZ', async () => {
      const queued = await enqueue({
        event: 'staff_internal',
        userId: clinic.owner.userId,
        branchId: clinic.branch.id,
        scheduledFor: new Date('2026-09-07T20:30:00Z'),
        variables: { subject: 'Gönderim hatası', message: 'Bir hatırlatma gönderilemedi.' },
      });
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      expect(queued.scheduledFor.toISOString()).toBe('2026-09-07T20:30:00.000Z');
    });
  });

  // -------------------------------------------------------------------------
  describe('şablonlar ve tercihler', () => {
    it('varsayılan şablonlar kiracı satırı olmadan da listelenir', async () => {
      const listed = await http(app)
        .get('/api/v1/notification-templates')
        .set(ownerAuth())
        .expect(200);

      const templates = listed.body as TemplateBody[];
      const reminderTemplate = templates.find(
        (row) => row.event === 'appointment_reminder' && row.channel === 'whatsapp',
      );
      expect(reminderTemplate?.isDefault).toBe(true);
      expect(reminderTemplate?.variables).toContain('customerName');
      // SMS müşteriye kapalı; doğum günü (pazarlama) olayı yok.
      expect(templates.some((row) => row.channel === 'sms')).toBe(false);
      expect(templates.some((row) => row.event === 'birthday')).toBe(false);
    });

    it('kiracının eşlediği template varsayılanın YERİNE geçer', async () => {
      await activate();
      await http(app)
        .put('/api/v1/notification-templates')
        .set(ownerAuth())
        .send({
          event: 'appointment_reminder',
          channel: 'whatsapp',
          body: 'Merhaba {{customerName}}, {{appointmentAt}} bekliyoruz.',
          whatsappTemplateName: 'klinik_hatirlatma',
          whatsappTemplateLanguage: 'tr',
          whatsappVariables: ['customerName', 'appointmentAt'],
        })
        .expect(200);

      const queued = await enqueue(reminder());
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      expect((listed.body as { data: MessageBody[] }).data[0]?.body).toBe(
        'Merhaba Ayşe Yılmaz, 7 Eylül 14:00 bekliyoruz.',
      );
      expect(JSON.stringify(sentToMeta()[0]?.body)).toContain('klinik_hatirlatma');
    });

    it('SMS kanalı artık kabul edilmez', async () => {
      // Kanal kümesinde yok: istek gövde doğrulamasında düşer.
      await setPreference({ event: 'appointment_reminder', channels: ['sms'] }).expect(400);
      await http(app)
        .put('/api/v1/notification-templates')
        .set(ownerAuth())
        .send({ event: 'appointment_reminder', channel: 'sms', body: 'Merhaba {{customerName}}' })
        .expect(400);
    });

    it('olayda TANIMLI OLMAYAN değişken şablona yazılamaz', async () => {
      const rejected = await http(app)
        .put('/api/v1/notification-templates')
        .set(ownerAuth())
        .send({
          event: 'appointment_reminder',
          channel: 'whatsapp',
          body: 'Merhaba {{tcKimlikNo}}',
        })
        .expect(422);

      expect((rejected.body as Problem).code).toBe('TEMPLATE_INVALID');
    });

    it('konu alanı yalnız e-posta kanalında kabul edilir', async () => {
      await http(app)
        .put('/api/v1/notification-templates')
        .set(ownerAuth())
        .send({
          event: 'appointment_reminder',
          channel: 'whatsapp',
          subject: 'Olmaz',
          body: 'Merhaba {{customerName}}',
        })
        .expect(422);
    });

    it('aynı kiracı tercihi ikinci kez yazıldığında TEK satır kalır', async () => {
      await setPreference({ event: 'no_show_followup', channels: ['whatsapp'] }).expect(200);
      await setPreference({ event: 'no_show_followup', channels: [] }).expect(200);

      const rows = await database.ownerPool.query<{ count: string }>(
        `select count(*)::text as count from notification_preferences where event = 'no_show_followup'`,
      );
      expect(rows.rows[0]?.count).toBe('1');
    });

    it('tercih kanal sırasını belirler; adresi olmayan kanal atlanır', async () => {
      await activateWhatsApp();
      await setPreference({
        event: 'appointment_reminder',
        channels: ['whatsapp'],
      }).expect(200);

      // Kanal override'ı OLMADAN: seçim tamamen tercihe kalsın.
      const base = reminder();
      delete (base as { channels?: unknown }).channels;
      const queued = await enqueue(base);
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      expect(queued.channel).toBe('whatsapp');
    });

    it('müşteri olayının tercihine e-posta YAZILAMAZ', async () => {
      const rejected = await setPreference({
        event: 'appointment_reminder',
        channels: ['email', 'whatsapp'],
      }).expect(422);
      expect((rejected.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('müşteri olayına e-posta ŞABLONU yazılamaz', async () => {
      const rejected = await http(app)
        .put('/api/v1/notification-templates')
        .set(ownerAuth())
        .send({
          event: 'appointment_reminder',
          channel: 'email',
          subject: 'Randevu hatırlatması',
          body: 'Merhaba {{customerName}}',
        })
        .expect(422);
      expect((rejected.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('şablon listesi müşteri olaylarında e-posta satırı DÖNDÜRMEZ', async () => {
      const listed = await http(app).get('/api/v1/notification-templates').set(ownerAuth()).expect(200);
      const rows = listed.body as { event: string; channel: string }[];
      expect(rows.some((row) => row.channel === 'email' && row.event !== 'staff_internal')).toBe(false);
      expect(rows.some((row) => row.channel === 'email' && row.event === 'staff_internal')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('yetki ve kiracı izolasyonu', () => {
    it('uygulayıcı mesajları okur ama şablon YAZAMAZ', async () => {
      await http(app).get('/api/v1/messages').set(auth(practitioner.tokens)).expect(200);

      const forbidden = await http(app)
        .put('/api/v1/notification-templates')
        .set(auth(practitioner.tokens))
        .send({ event: 'appointment_reminder', channel: 'whatsapp', body: 'Merhaba {{customerName}}' })
        .expect(403);
      expect((forbidden.body as Problem).code).toBe('FORBIDDEN');
    });

    it('bir kiracının mesajları diğerinin listesinde GÖRÜNMEZ', async () => {
      await activateWhatsApp();
      const queued = await enqueue(reminder());
      expect(queued.status).toBe('queued');

      const other = await setupClinic(app, { slug: 'ikinci-klinik' });

      const listed = await http(app).get('/api/v1/messages').set(auth(other.owner.tokens)).expect(200);
      expect((listed.body as { data: MessageBody[] }).data).toHaveLength(0);
    });
  });
});
