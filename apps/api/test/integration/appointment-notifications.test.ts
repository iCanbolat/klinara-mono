import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NotificationSenderWorker } from '../../src/modules/notifications/notification-sender.worker';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { GraphMock } from '../helpers/whatsapp';

interface AppointmentBody {
  id: string;
  status: string;
  startsAt: string;
}

interface MessageBody {
  id: string;
  status: string;
  event: string;
  channel: string;
  body: string | null;
}

const monday = (offsetDays: number): string => {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)}T11:00:00+03:00`;
};

describe('randevu oluşturma / iptal bildirimleri', () => {
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
    await activateWhatsApp();
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);
  /** WhatsApp hesabını kaydeder ve doğrular: müşteriye giden tek kanal bu. */
  const activateWhatsApp = async () => {
    await http(app)
      .put('/api/v1/integrations/whatsapp')
      .set(auth(clinic.owner.tokens))
      .send({
        wabaId: '102290129340398',
        phoneNumberId: '106540352242922',
        businessPhone: '+905321112233',
        accessToken: 'EAAG-cok-gizli-erisim-tokeni-a91f',
        appSecret: 'webhook-imza-sirri',
      })
      .expect(200);
    await http(app)
      .post('/api/v1/integrations/whatsapp/verify')
      .set(auth(clinic.owner.tokens))
      .expect(200);
    graph.reset();
  };
  /** Meta'ya giden mesaj gönderimleri. */
  const sentToMeta = () => graph.requests.filter((request) => request.url.endsWith('/messages'));

  const create = (extra: Record<string, unknown> = {}, startsAt = monday(7)) =>
    http(app)
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
        ...extra,
      });

  const createAppointment = async (extra: Record<string, unknown> = {}): Promise<AppointmentBody> =>
    (await create(extra).expect(201)).body as AppointmentBody;

  const cancel = (id: string, body: Record<string, unknown> = {}) =>
    http(app)
      .post(`/api/v1/appointments/${id}/cancel`)
      .set(ownerAuth())
      .set(branch())
      .send({ reason: 'Müşteri istedi', ...body })
      .expect(200);

  const messages = async (event?: string): Promise<MessageBody[]> => {
    const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
    const rows = (listed.body as { data: MessageBody[] }).data;
    return event === undefined ? rows : rows.filter((row) => row.event === event);
  };

  describe('oluşturma', () => {
    it('randevu açılınca onay mesajı kuyruğa girer ve WhatsApp’tan çıkar', async () => {
      await createAppointment();

      const [message] = await messages('appointment_confirmation');
      expect(message?.status).toBe('queued');
      expect(message?.channel).toBe('whatsapp');
      expect(message?.body).toContain('Ayşe Yılmaz');
      // Saat ŞUBENİN saat diliminde.
      expect(message?.body).toContain('11:00');
      expect(message?.body).toContain('oluşturuldu');

      await app
        .get(NotificationSenderWorker)
        .handle({ tenantId: clinic.tenant.id, messageId: message?.id ?? '' });
      expect(sentToMeta()).toHaveLength(1);
    });

    it('`notifyCustomer: false` ile mesaj yazılmaz', async () => {
      await createAppointment({ notifyCustomer: false });
      expect(await messages('appointment_confirmation')).toHaveLength(0);
    });

    it('geçmiş tarihli randevuya bildirim gitmez', async () => {
      const res = await create({}, monday(-14));
      expect(res.status).toBe(201);
      expect(await messages('appointment_confirmation')).toHaveLength(0);
    });

    it('*** ATOMİKLİK *** çakışan randevu (409) mesaj bırakmaz', async () => {
      await createAppointment();
      await create().expect(409);
      expect(await messages('appointment_confirmation')).toHaveLength(1);
    });

    it('aynı Idempotency-Key ile tekrar tek mesaj üretir', async () => {
      const send = () => create().set('idempotency-key', 'appt-notify-1');
      await send().expect(201);
      await send();
      expect(await messages('appointment_confirmation')).toHaveLength(1);
    });

    it('olay tercihlerden kapatılmışsa mesaj yazılmaz', async () => {
      await http(app)
        .put('/api/v1/notification-preferences')
        .set(ownerAuth())
        .send({ event: 'appointment_confirmation', channels: [] })
        .expect(200);
      await createAppointment();
      expect(await messages('appointment_confirmation')).toHaveLength(0);
    });
  });

  describe('iptal', () => {
    it('iptal edilen randevu için iptal mesajı yazılır', async () => {
      const appointment = await createAppointment();
      await cancel(appointment.id);

      const [message] = await messages('appointment_cancelled');
      expect(message?.status).toBe('queued');
      expect(message?.body).toContain('iptal edilmiştir');
      expect(message?.body).toContain('11:00');
    });

    it('`notifyCustomer: false` ile iptal mesajı yazılmaz', async () => {
      const appointment = await createAppointment();
      await cancel(appointment.id, { notifyCustomer: false });
      expect(await messages('appointment_cancelled')).toHaveLength(0);
    });

    it('durum ucuyla iptal de bildirilir', async () => {
      const appointment = await createAppointment();
      await http(app)
        .post(`/api/v1/appointments/${appointment.id}/status`)
        .set(ownerAuth())
        .set(branch())
        .send({ status: 'cancelled' })
        .expect(200);
      expect(await messages('appointment_cancelled')).toHaveLength(1);
    });

    it('aynı iptalin tekrarı ikinci mesaj üretmez', async () => {
      const appointment = await createAppointment();
      await cancel(appointment.id);
      await cancel(appointment.id);
      expect(await messages('appointment_cancelled')).toHaveLength(1);
    });

    it('iptal olmayan durum değişiklikleri iptal mesajı üretmez', async () => {
      const appointment = await createAppointment();
      await http(app)
        .post(`/api/v1/appointments/${appointment.id}/status`)
        .set(ownerAuth())
        .set(branch())
        .send({ status: 'confirmed' })
        .expect(200);
      expect(await messages('appointment_cancelled')).toHaveLength(0);
    });
  });
});
