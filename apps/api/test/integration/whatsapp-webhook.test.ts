import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { MessageActionsService } from '../../src/modules/integrations/message-actions.service';
import { NotificationDispatcherService } from '../../src/modules/notifications/notification-dispatcher.service';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { GraphMock } from '../helpers/whatsapp';

interface Problem {
  code: string;
  status: number;
}

interface AppointmentBody {
  id: string;
  status: string;
}

interface InboxItem {
  id: string;
  from: string;
  body: string | null;
  customerId: string | null;
}

interface MessageBody {
  status: string;
  event: string;
  body: string | null;
  deliveredAt: string | null;
}

const APP_SECRET = 'webhook-imza-sirri-uzun';
const VERIFY_TOKEN = 'yerel-webhook-dogrulama-tokeni';
const WABA_ID = '102290129340398';

/** Gelecekteki bir pazartesi — iptal penceresinin AÇIK olduğu bir tarih. */
const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('WhatsApp gelen webhook (Batch 8.3)', () => {
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
        WHATSAPP_API_BASE_URL: baseUrl,
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
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
    await http(app)
      .put('/api/v1/integrations/whatsapp')
      .set(auth(clinic.owner.tokens))
      .send({
        wabaId: WABA_ID,
        phoneNumberId: '106540352242922',
        accessToken: 'EAAG-token-a91f',
        appSecret: APP_SECRET,
      })
      .expect(200);
  });

  const ownerAuth = () => auth(clinic.owner.tokens);

  const sign = (body: string, secret = APP_SECRET): string =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  /** Gövde METİN olarak gönderilir: imza ham baytlar üzerinden hesaplanıyor. */
  const post = (body: string, signature: string | undefined) => {
    const request = http(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('content-type', 'application/json');
    if (signature !== undefined) request.set('x-hub-signature-256', signature);
    return request.send(body);
  };

  const statusEvent = (providerMessageId: string, status: string): string =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              value: {
                metadata: { phone_number_id: '106540352242922' },
                statuses: [{ id: providerMessageId, status, timestamp: '1789000000' }],
              },
            },
          ],
        },
      ],
    });

  const messageEvent = (message: Record<string, unknown>): string =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              value: {
                metadata: { phone_number_id: '106540352242922' },
                messages: [
                  {
                    id: `wamid.${Math.random().toString(36).slice(2)}`,
                    from: '905321234567',
                    timestamp: '1789000000',
                    type: 'text',
                    ...message,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

  const createAppointment = async (time = '14:00'): Promise<string> => {
    const created = await http(app)
      .post('/api/v1/appointments')
      .set(ownerAuth())
      .set(branchHeader(clinic.branch.id))
      .send({
        branchId: clinic.branch.id,
        customerId: clinic.customer.id,
        startsAt: at(time),
        services: [
          { serviceId: clinic.quickService.id, staffProfileId: clinic.practitioner.staffProfileId },
        ],
      })
      .expect(201);
    return (created.body as AppointmentBody).id;
  };

  const issueToken = (appointmentId: string, action: 'confirm' | 'cancel', ttlHours?: number) =>
    app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
      app.get(MessageActionsService).issue(tx, clinic.tenant.id, {
        appointmentId,
        action,
        ...(ttlHours === undefined ? {} : { ttlHours }),
      }),
    );

  const readAppointment = async (id: string): Promise<AppointmentBody> => {
    const res = await http(app)
      .get(`/api/v1/appointments/${id}`)
      .set(ownerAuth())
      .set(branchHeader(clinic.branch.id))
      .expect(200);
    return res.body as AppointmentBody;
  };

  const messages = async (): Promise<MessageBody[]> => {
    const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
    return (listed.body as { data: MessageBody[] }).data;
  };

  // -------------------------------------------------------------------------
  describe('imza doğrulaması', () => {
    it('geçersiz imzalı istek 401 alır ve HİÇBİR ŞEY işlenmez', async () => {
      const body = messageEvent({ text: { body: 'Merhaba' } });
      const rejected = await post(body, sign(body, 'yanlis-sir')).expect(401);
      expect((rejected.body as Problem).code).toBe('UNAUTHENTICATED');

      const events = await database.ownerPool.query('select 1 from webhook_events');
      expect(events.rows).toHaveLength(0);
    });

    it('imzasız istek 401 alır', async () => {
      const body = messageEvent({ text: { body: 'Merhaba' } });
      await post(body, undefined).expect(401);
    });

    it('*** KRİTİK *** imza HAM GÖVDE üzerinden doğrulanır', async () => {
      // Meta'nın gönderdiği gövde ile aynı VERİ ama farklı SERİLEŞTİRME:
      // alan sırası ve boşluk değişince imza tutmaz. Sunucu gövdeyi parse edip
      // yeniden serialize etseydi bu test geçerdi ve üretimde her imza
      // sessizce başarısız olurdu.
      const original = messageEvent({ text: { body: 'Merhaba' } });
      const reserialized = JSON.stringify(JSON.parse(original), null, 2);
      expect(reserialized).not.toBe(original);

      // Ham gövdeyle imzalanmış istek geçer…
      await post(original, sign(original)).expect(200);
      // …aynı imza, yeniden serialize edilmiş gövdeyle GEÇMEZ.
      await post(reserialized, sign(original)).expect(401);
    });

    it('tanınmayan WABA kimliği 401 alır', async () => {
      const body = JSON.stringify({ entry: [{ id: 'baska-waba', changes: [] }] });
      await post(body, sign(body)).expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('idempotency', () => {
    it('aynı olay iki kez gelirse TEK kez işlenir', async () => {
      const body = messageEvent({ text: { body: 'Merhaba' } });

      const first = await post(body, sign(body)).expect(200);
      expect((first.body as { duplicate: boolean }).duplicate).toBe(false);

      const second = await post(body, sign(body)).expect(200);
      expect((second.body as { duplicate: boolean }).duplicate).toBe(true);

      const inbox = await http(app).get('/api/v1/inbox').set(ownerAuth()).expect(200);
      expect(inbox.body).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('teslim durumu', () => {
    it('`delivered` bildirimi mesaj kaydını günceller', async () => {
      const queued = await app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
        app.get(NotificationDispatcherService).enqueue(tx, clinic.tenant.id, {
          event: 'appointment_reminder',
          customerId: clinic.customer.id,
          branchId: clinic.branch.id,
          channels: ['sms'],
          variables: {
            customerName: 'Ayşe',
            branchName: 'Merkez',
            appointmentAt: '14:00',
            serviceName: 'Lazer',
          },
        }),
      );
      if (queued.status !== 'queued') throw new Error('kuyruğa yazılmalıydı');

      await database.ownerPool.query(
        `update message_log set provider_message_id = 'wamid.ABC', status = 'sent' where id = $1`,
        [queued.messageId],
      );

      const body = statusEvent('wamid.ABC', 'delivered');
      await post(body, sign(body)).expect(200);

      const row = (await messages())[0];
      expect(row?.status).toBe('delivered');
      expect(row?.deliveredAt).not.toBeNull();
    });

    it('`read` gelmiş bir mesaj sonradan gelen `delivered` ile GERİ GİTMEZ', async () => {
      await database.ownerPool.query(
        `insert into message_log (tenant_id, customer_id, channel, event, to_masked, status, provider_message_id)
         values ($1, $2, 'whatsapp', 'appointment_reminder', '+90****67', 'read', 'wamid.XYZ')`,
        [clinic.tenant.id, clinic.customer.id],
      );

      const body = statusEvent('wamid.XYZ', 'delivered');
      await post(body, sign(body)).expect(200);

      const row = (await messages())[0];
      expect(row?.status).toBe('read');
    });
  });

  // -------------------------------------------------------------------------
  describe('buton yanıtı', () => {
    it('Onayla butonu randevuyu `confirmed` yapar ve iz bırakır', async () => {
      const appointmentId = await createAppointment();
      const token = await issueToken(appointmentId, 'confirm');

      const body = messageEvent({ type: 'button', button: { payload: token, text: 'Onayla' } });
      await post(body, sign(body)).expect(200);

      expect((await readAppointment(appointmentId)).status).toBe('confirmed');

      const history = await http(app)
        .get(`/api/v1/appointments/${appointmentId}/history`)
        .set(ownerAuth())
        .set(branchHeader(clinic.branch.id))
        .expect(200);
      expect(JSON.stringify(history.body)).toContain('WhatsApp buton yanıtı');

      // Müşteriye otomatik cevap YAZILDI ve kayıtta duruyor.
      const reply = (await messages()).find((row) => row.event === 'auto_reply');
      expect(reply?.body).toContain('onaylandı');
    });

    it('İptal butonu randevuyu iptal eder', async () => {
      const appointmentId = await createAppointment();
      const token = await issueToken(appointmentId, 'cancel');

      const body = messageEvent({
        type: 'interactive',
        interactive: { button_reply: { id: token, title: 'İptal Et' } },
      });
      await post(body, sign(body)).expect(200);

      expect((await readAppointment(appointmentId)).status).toBe('cancelled');
    });

    it('token TEK KULLANIMLIKTIR — ikinci kullanım randevuyu değiştirmez', async () => {
      const appointmentId = await createAppointment();
      const token = await issueToken(appointmentId, 'cancel');

      const first = messageEvent({ type: 'button', button: { payload: token } });
      await post(first, sign(first)).expect(200);

      // İkinci istek FARKLI bir gövde (yeni mesaj kimliği), yani idempotency
      // devrede değil: reddeden şey token'ın kendisi.
      const second = messageEvent({ type: 'button', button: { payload: token } });
      await post(second, sign(second)).expect(200);

      expect((await readAppointment(appointmentId)).status).toBe('cancelled');
      const reply = (await messages()).find((row) => row.body?.includes('kullanılmış') === true);
      expect(reply).toBeDefined();
    });

    it('süresi dolmuş token randevuyu değiştirmez, nazik cevap gider', async () => {
      const appointmentId = await createAppointment();
      const token = await issueToken(appointmentId, 'cancel', 1);
      await database.ownerPool.query(`update message_actions set expires_at = now() - interval '1 hour'`);

      const body = messageEvent({ type: 'button', button: { payload: token } });
      await post(body, sign(body)).expect(200);

      expect((await readAppointment(appointmentId)).status).toBe('scheduled');
      const reply = (await messages()).find((row) => row.event === 'auto_reply');
      expect(reply?.body).toContain('süresi dolmuş');
    });

    it('iptal penceresi kapalıysa randevu İPTAL EDİLMEZ', async () => {
      const appointmentId = await createAppointment();
      // Pencereyi randevunun ötesine taşıyoruz: artık "çok geç".
      await database.ownerPool.query('update tenant_settings set cancel_window_hours = 8760');

      const token = await issueToken(appointmentId, 'cancel');
      const body = messageEvent({ type: 'button', button: { payload: token } });
      await post(body, sign(body)).expect(200);

      expect((await readAppointment(appointmentId)).status).toBe('scheduled');
      const reply = (await messages()).find((row) => row.event === 'auto_reply');
      expect(reply?.body).toContain('iptal süresi dolmuş');
    });
  });

  // -------------------------------------------------------------------------
  describe('gelen kutusu', () => {
    it('serbest metin gelen kutusuna düşer ve numara MASKELİ döner', async () => {
      const body = messageEvent({ text: { body: 'Yarın müsait misiniz?' } });
      await post(body, sign(body)).expect(200);

      const inbox = await http(app).get('/api/v1/inbox').set(ownerAuth()).expect(200);
      const items = inbox.body as InboxItem[];
      expect(items).toHaveLength(1);
      expect(items[0]?.body).toBe('Yarın müsait misiniz?');
      expect(items[0]?.customerId).toBe(clinic.customer.id);
      expect(items[0]?.from).toMatch(/^\+90\*+\d{2}$/);
    });

    it('tanınmayan numara da kaydedilir (müşteri kaydı olmadan)', async () => {
      const body = JSON.stringify({
        entry: [
          {
            id: WABA_ID,
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.YABANCI',
                      from: '905559998877',
                      type: 'text',
                      text: { body: 'Fiyat listesi alabilir miyim?' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      await post(body, sign(body)).expect(200);

      const inbox = await http(app).get('/api/v1/inbox').set(ownerAuth()).expect(200);
      expect((inbox.body as InboxItem[])[0]?.customerId).toBeNull();
    });

    it('"STOP" mesajı pazarlama iletilerini durdurur', async () => {
      const body = messageEvent({ text: { body: 'STOP' } });
      await post(body, sign(body)).expect(200);

      const optOuts = await http(app)
        .get(`/api/v1/customers/${clinic.customer.id}/opt-out`)
        .set(ownerAuth())
        .expect(200);
      expect(optOuts.body).toHaveLength(1);
      expect((optOuts.body as { source: string }[])[0]?.source).toBe('inbound_stop');
    });

    it('mesaj işlendi olarak işaretlenebilir', async () => {
      const body = messageEvent({ text: { body: 'Merhaba' } });
      await post(body, sign(body)).expect(200);

      const inbox = await http(app).get('/api/v1/inbox').set(ownerAuth()).expect(200);
      const id = (inbox.body as InboxItem[])[0]?.id;
      await http(app).post(`/api/v1/inbox/${id}/handle`).set(ownerAuth()).expect(204);

      const after = await http(app).get('/api/v1/inbox').set(ownerAuth()).expect(200);
      expect(after.body).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('hub.challenge doğrulaması', () => {
    it('doğru token ile challenge’ı geri döner', async () => {
      const res = await http(app)
        .get('/api/v1/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '12345' })
        .expect(200);
      expect(res.text).toBe('12345');
    });

    it('yanlış token 401 alır', async () => {
      await http(app)
        .get('/api/v1/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'yanlis', 'hub.challenge': '12345' })
        .expect(401);
    });
  });
});
