import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { NotificationDispatcherService } from '../../src/modules/notifications/notification-dispatcher.service';
import { NotificationSenderWorker } from '../../src/modules/notifications/notification-sender.worker';
import { MAIL_SENDER } from '../../src/lib/mail/mail.types';
import type { LogMailSender } from '../../src/lib/mail/mail.module';
import { SMS_SENDER } from '../../src/lib/sms/sms.types';
import type { LogSmsSender } from '../../src/lib/sms/log.sender';
import type { EnqueueInput } from '../../src/modules/notifications/notification-dispatcher.service';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

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
    clinic = await setupClinic(app);
    practitioner = clinic.practitioner;
    mail().sent.length = 0;
    sms().sent.length = 0;
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const mail = () => app.get<LogMailSender>(MAIL_SENDER);
  const sms = () => app.get<LogSmsSender>(SMS_SENDER);

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
    channels: ['sms'],
    variables: {
      customerName: 'Ayşe Yılmaz',
      branchName: 'Merkez',
      appointmentAt: '7 Eylül 14:00',
      serviceName: 'Lazer',
    },
    ...overrides,
  });

  const setPreference = (body: Record<string, unknown>) =>
    http(app).put('/api/v1/notification-preferences').set(ownerAuth()).send(body);

  // -------------------------------------------------------------------------
  describe('gönderim akışı', () => {
    it('mesajı kuyruğa yazar, worker gönderir ve kayıt `sent` olur', async () => {
      const queued = await enqueue(reminder());
      expect(queued.status).toBe('queued');
      if (queued.status !== 'queued') return;

      await runWorker(queued.messageId);

      expect(sms().sent).toHaveLength(1);
      expect(sms().sent[0]?.body).toContain('Ayşe Yılmaz');

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      const data = (listed.body as { data: MessageBody[] }).data;
      expect(data).toHaveLength(1);
      expect(data[0]?.status).toBe('sent');
      expect(data[0]?.channel).toBe('sms');
    });

    it('alıcı adresi yanıtta da veritabanında da MASKELİ durur', async () => {
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

    it('yapılandırılmamış kanal KALICI hatadır — yeniden denenmez', async () => {
      // Varsayılan tercih WhatsApp'ı ilk sıraya koyar; kiracının WhatsApp
      // hesabı yoksa gönderim KALICI olarak başarısız olur (8.2'den beri kod
      // `WHATSAPP_NOT_CONFIGURED`; 8.1'de genel `CHANNEL_NOT_CONFIGURED`ti).
      const queued = await enqueue(reminder({ channels: ['whatsapp'] }));
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      // Fırlatmaz: kalıcı hata kuyruğu meşgul etmemeli.
      await expect(runWorker(queued.messageId)).resolves.toBeUndefined();

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      const row = (listed.body as { data: MessageBody[] }).data[0];
      expect(row?.status).toBe('failed');
      expect(row?.errorCode).toBe('WHATSAPP_NOT_CONFIGURED');
    });

    it('kuyruktan çıkmış bir mesajı worker YENİDEN göndermez', async () => {
      const queued = await enqueue(reminder());
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      await runWorker(queued.messageId);
      await runWorker(queued.messageId);

      expect(sms().sent).toHaveLength(1);
    });

    it('e-posta kanalı SMTP yapılandırılmamışken loga düşer', async () => {
      const queued = await enqueue(reminder({ channels: ['email'] }));
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      expect(mail().sent).toHaveLength(1);
      expect(mail().sent[0]?.subject).toBe('Randevu hatırlatması');
    });

    it('adresi olmayan alıcı için mesaj kaydı HİÇ yazılmaz', async () => {
      const created = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth())
        .send({ fullName: 'Telefonsuz Müşteri' })
        .expect(201);

      const result = await enqueue(
        reminder({ customerId: (created.body as { id: string }).id, channels: ['sms', 'email'] }),
      );
      expect(result.status).toBe('skipped');

      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      expect((listed.body as { data: MessageBody[] }).data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('opt-out', () => {
    const birthday = (): EnqueueInput => ({
      event: 'birthday',
      customerId: clinic.customer.id,
      branchId: clinic.branch.id,
      channels: ['sms'],
      variables: { customerName: 'Ayşe Yılmaz', branchName: 'Merkez' },
    });

    it('PAZARLAMA iletisini engeller ve `skipped` olarak KAYDEDER', async () => {
      await http(app)
        .post(`/api/v1/customers/${clinic.customer.id}/opt-out`)
        .set(ownerAuth())
        .send({})
        .expect(201);

      const result = await enqueue(birthday());
      expect(result.status).toBe('skipped');
      if (result.status !== 'skipped') return;
      expect(result.reason).toBe('OPT_OUT');

      // Engellenen mesaj ATILMAZ: "gitmedi mi, hiç denendi mi?" cevaplanabilmeli.
      const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
      const row = (listed.body as { data: MessageBody[] }).data[0];
      expect(row?.status).toBe('skipped');
      expect(row?.errorCode).toBe('OPT_OUT');
      expect(sms().sent).toHaveLength(0);
    });

    it('İŞLEMSEL iletiyi engellemez — randevu hatırlatması ticari ileti değildir', async () => {
      await http(app)
        .post(`/api/v1/customers/${clinic.customer.id}/opt-out`)
        .set(ownerAuth())
        .send({})
        .expect(201);

      const result = await enqueue(reminder());
      expect(result.status).toBe('queued');
    });

    it('kanal bazlı reddi yalnız O kanalda uygular', async () => {
      await http(app)
        .post(`/api/v1/customers/${clinic.customer.id}/opt-out`)
        .set(ownerAuth())
        .send({ channel: 'sms' })
        .expect(201);

      const blocked = await enqueue(birthday());
      expect(blocked.status).toBe('skipped');

      const allowed = await enqueue({ ...birthday(), channels: ['whatsapp'] });
      expect(allowed.status).toBe('queued');
    });

    it('geri alma satırı SİLMEZ, `revoked_at` doldurur', async () => {
      await http(app)
        .post(`/api/v1/customers/${clinic.customer.id}/opt-out`)
        .set(ownerAuth())
        .send({})
        .expect(201);

      await http(app)
        .delete(`/api/v1/customers/${clinic.customer.id}/opt-out`)
        .set(ownerAuth())
        .expect(204);

      const active = await http(app)
        .get(`/api/v1/customers/${clinic.customer.id}/opt-out`)
        .set(ownerAuth())
        .expect(200);
      expect(active.body).toHaveLength(0);

      const rows = await database.ownerPool.query<{ count: string }>(
        'select count(*)::text as count from contact_opt_outs where revoked_at is not null',
      );
      expect(rows.rows[0]?.count).toBe('1');

      // Geri alındıktan sonra pazarlama iletisi yeniden gider.
      const result = await enqueue(birthday());
      expect(result.status).toBe('queued');
    });
  });

  // -------------------------------------------------------------------------
  describe('çift gönderim ve sessiz saatler', () => {
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

    it('şube tercihindeki sessiz saat penceresi kiracı varsayılanını EZER', async () => {
      await setPreference({
        branchId: clinic.branch.id,
        event: 'appointment_reminder',
        channels: ['sms'],
        quietHoursStart: '23:00',
        quietHoursEnd: '07:00',
      }).expect(200);

      // 22:00 İstanbul — kiracı varsayılanında (21:00) sessiz, şube
      // penceresinde (23:00) değil.
      const queued = await enqueue(reminder({ scheduledFor: new Date('2026-09-07T19:00:00Z') }));
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      expect(queued.scheduledFor.toISOString()).toBe('2026-09-07T19:00:00.000Z');
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
      const smsReminder = templates.find(
        (row) => row.event === 'appointment_reminder' && row.channel === 'sms',
      );
      expect(smsReminder?.isDefault).toBe(true);
      expect(smsReminder?.variables).toContain('customerName');
    });

    it('kiracı şablonu varsayılanın YERİNE geçer', async () => {
      await http(app)
        .put('/api/v1/notification-templates')
        .set(ownerAuth())
        .send({
          event: 'appointment_reminder',
          channel: 'sms',
          body: 'Merhaba {{customerName}}, {{appointmentAt}} bekliyoruz.',
        })
        .expect(200);

      const queued = await enqueue(reminder());
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      await runWorker(queued.messageId);

      expect(sms().sent[0]?.body).toBe('Merhaba Ayşe Yılmaz, 7 Eylül 14:00 bekliyoruz.');
    });

    it('olayda TANIMLI OLMAYAN değişken şablona yazılamaz', async () => {
      const rejected = await http(app)
        .put('/api/v1/notification-templates')
        .set(ownerAuth())
        .send({
          event: 'appointment_reminder',
          channel: 'sms',
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
          channel: 'sms',
          subject: 'Olmaz',
          body: 'Merhaba {{customerName}}',
        })
        .expect(422);
    });

    it('aynı kiracı tercihi ikinci kez yazıldığında TEK satır kalır', async () => {
      await setPreference({ event: 'birthday', channels: ['sms'] }).expect(200);
      await setPreference({ event: 'birthday', channels: ['email'] }).expect(200);

      const rows = await database.ownerPool.query<{ count: string }>(
        `select count(*)::text as count from notification_preferences where event = 'birthday'`,
      );
      expect(rows.rows[0]?.count).toBe('1');
    });

    it('tercih kanal sırasını belirler; adresi olmayan kanal atlanır', async () => {
      await setPreference({
        event: 'appointment_reminder',
        channels: ['email', 'sms'],
      }).expect(200);

      // Kanal override'ı OLMADAN: seçim tamamen tercihe kalsın.
      const base = reminder();
      delete (base as { channels?: unknown }).channels;
      const queued = await enqueue(base);
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');
      expect(queued.channel).toBe('email');
    });
  });

  // -------------------------------------------------------------------------
  describe('yetki ve kiracı izolasyonu', () => {
    it('uygulayıcı mesajları okur ama şablon YAZAMAZ', async () => {
      await http(app).get('/api/v1/messages').set(auth(practitioner.tokens)).expect(200);

      const forbidden = await http(app)
        .put('/api/v1/notification-templates')
        .set(auth(practitioner.tokens))
        .send({ event: 'birthday', channel: 'sms', body: 'Merhaba {{customerName}}' })
        .expect(403);
      expect((forbidden.body as Problem).code).toBe('FORBIDDEN');
    });

    it('bir kiracının mesajları diğerinin listesinde GÖRÜNMEZ', async () => {
      const queued = await enqueue(reminder());
      expect(queued.status).toBe('queued');

      const other = await setupClinic(app, { slug: 'ikinci-klinik' });

      const listed = await http(app).get('/api/v1/messages').set(auth(other.owner.tokens)).expect(200);
      expect((listed.body as { data: MessageBody[] }).data).toHaveLength(0);
    });
  });
});
