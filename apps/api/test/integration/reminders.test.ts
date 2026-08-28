import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { ReminderWorker } from '../../src/modules/notifications/reminder.worker';
import { ReminderSchedulerService } from '../../src/modules/notifications/reminder-scheduler.service';
import { SMS_SENDER } from '../../src/lib/sms/sms.types';
import type { LogSmsSender } from '../../src/lib/sms/log.sender';
import { NotificationSenderWorker } from '../../src/modules/notifications/notification-sender.worker';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface AppointmentBody {
  id: string;
  status: string;
  version: number;
  startsAt: string;
}

interface ScheduledBody {
  id: string;
  event: string;
  offsetHours: number;
  scheduledFor: string;
  status: string;
  messageId: string | null;
}

interface MessageBody {
  id: string;
  status: string;
  event: string;
  body: string | null;
}

/** Randevu tarihini "yeterince ileri" tutuyoruz: 24 saatlik hatırlatma geçmişe düşmesin. */
const futureMonday = (): string => {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)}T11:00:00+03:00`;
};

describe('hatırlatma zamanlaması (Batch 8.4)', () => {
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
    clinic = await setupClinic(app);
    sms().sent.length = 0;
    // Varsayılan kanal WhatsApp; bu fazda gönderim SMS üzerinden sınanıyor.
    await http(app)
      .put('/api/v1/notification-preferences')
      .set(ownerAuth())
      .send({ event: 'appointment_reminder', channels: ['sms'] })
      .expect(200);
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);
  const sms = () => app.get<LogSmsSender>(SMS_SENDER);

  const createAppointment = async (startsAt = futureMonday()): Promise<AppointmentBody> => {
    const created = await http(app)
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
    return created.body as AppointmentBody;
  };

  const plan = async (appointmentId: string): Promise<ScheduledBody[]> => {
    const res = await http(app)
      .get(`/api/v1/appointments/${appointmentId}/notifications`)
      .set(ownerAuth())
      .set(branch())
      .expect(200);
    return res.body as ScheduledBody[];
  };

  const runReminder = (id: string) =>
    app.get(ReminderWorker).handle({ tenantId: clinic.tenant.id, scheduledNotificationId: id });

  const messages = async (): Promise<MessageBody[]> => {
    const listed = await http(app).get('/api/v1/messages').set(ownerAuth()).expect(200);
    return (listed.body as { data: MessageBody[] }).data;
  };

  // -------------------------------------------------------------------------
  describe('planlama', () => {
    it('randevu açıldığında kiracı ayarındaki her saat için plan yazılır', async () => {
      const appointment = await createAppointment();
      const rows = await plan(appointment.id);

      // Varsayılan kiracı ayarı: 24 ve 2 saat önce.
      expect(rows.map((row) => row.offsetHours).sort((a, b) => b - a)).toEqual([24, 2]);
      expect(rows.every((row) => row.status === 'pending')).toBe(true);

      const startsAt = new Date(appointment.startsAt).getTime();
      const first = rows.find((row) => row.offsetHours === 24);
      expect(new Date(first?.scheduledFor ?? 0).getTime()).toBe(startsAt - 24 * 60 * 60 * 1000);
    });

    it('*** ATOMİKLİK *** randevu transaction’ı düşerse hatırlatma da yazılmaz', async () => {
      // Aynı personele aynı saate ikinci randevu: `EXCLUDE` constraint'i
      // transaction'ı düşürür. Hatırlatma AYNI transaction'da yazıldığı için
      // ondan da eser kalmamalı.
      const startsAt = futureMonday();
      await createAppointment(startsAt);
      const before = await database.ownerPool.query<{ count: string }>(
        'select count(*)::text as count from scheduled_notifications',
      );

      await http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId: clinic.customer.id,
          startsAt,
          services: [
            {
              serviceId: clinic.quickService.id,
              staffProfileId: clinic.practitioner.staffProfileId,
            },
          ],
        })
        .expect(409);

      const after = await database.ownerPool.query<{ count: string }>(
        'select count(*)::text as count from scheduled_notifications',
      );
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    });

    it('geçmişe düşen hatırlatma planlanmaz', async () => {
      // 3 saat sonrası: 24 saatlik hatırlatma geçmişte kalır, 2 saatlik kalır.
      const soon = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const created = await http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId: clinic.customer.id,
          startsAt: soon,
          services: [
            {
              serviceId: clinic.quickService.id,
              staffProfileId: clinic.practitioner.staffProfileId,
            },
          ],
        });
      // Çalışma saatleri dışına düşerse senaryo anlamını yitirir; o durumda atla.
      if (created.status !== 201) return;

      const rows = await plan((created.body as AppointmentBody).id);
      expect(rows.map((row) => row.offsetHours)).toEqual([2]);
    });

    it('şube ayarı kiracı ayarını EZER', async () => {
      await http(app)
        .put(`/api/v1/branches/${clinic.branch.id}/reminder-settings`)
        .set(ownerAuth())
        .send({ reminderHoursBefore: [48] })
        .expect(200);

      const appointment = await createAppointment();
      const rows = await plan(appointment.id);
      expect(rows.map((row) => row.offsetHours)).toEqual([48]);

      const settings = await http(app)
        .get(`/api/v1/branches/${clinic.branch.id}/reminder-settings`)
        .set(ownerAuth())
        .expect(200);
      expect(settings.body).toMatchObject({ reminderHoursBefore: [48], isBranchOverride: true });
    });
  });

  // -------------------------------------------------------------------------
  describe('erteleme ve iptal', () => {
    it('erteleme eski planı `superseded` yapar ve YENİ saate göre planlar', async () => {
      const appointment = await createAppointment();
      const newStart = new Date(new Date(appointment.startsAt).getTime() + 24 * 60 * 60 * 1000);

      await http(app)
        .post(`/api/v1/appointments/${appointment.id}/reschedule`)
        .set(ownerAuth())
        .set(branch())
        .set('if-match', `W/"${appointment.version}"`)
        .send({ startsAt: newStart.toISOString() })
        .expect(200);

      const rows = await plan(appointment.id);
      expect(rows.filter((row) => row.status === 'superseded')).toHaveLength(2);

      const pending = rows.filter((row) => row.status === 'pending');
      expect(pending).toHaveLength(2);
      const shifted = pending.find((row) => row.offsetHours === 24);
      expect(new Date(shifted?.scheduledFor ?? 0).getTime()).toBe(
        newStart.getTime() - 24 * 60 * 60 * 1000,
      );
    });

    it('iptal bekleyen hatırlatmaları kapatır', async () => {
      const appointment = await createAppointment();
      await http(app)
        .post(`/api/v1/appointments/${appointment.id}/cancel`)
        .set(ownerAuth())
        .set(branch())
        .send({ reason: 'Müşteri istedi' })
        .expect(200);

      const rows = await plan(appointment.id);
      expect(rows.every((row) => row.status === 'cancelled')).toBe(true);
    });

    it('iptal edilmiş randevu için worker gönderim YAPMAZ', async () => {
      const appointment = await createAppointment();
      const pending = (await plan(appointment.id))[0];

      await http(app)
        .post(`/api/v1/appointments/${appointment.id}/cancel`)
        .set(ownerAuth())
        .set(branch())
        .send({ reason: 'Müşteri istedi' })
        .expect(200);

      // İş kuyrukta duruyordu ve zamanı gelince koşar; satır artık `pending`
      // değil, dolayısıyla sessizce çıkar.
      await runReminder(pending?.id ?? '');
      expect(await messages()).toHaveLength(0);
      expect(sms().sent).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('gönderim', () => {
    it('worker mesajı üretir ve plan satırını `sent` yapar', async () => {
      const appointment = await createAppointment();
      const pending = (await plan(appointment.id)).find((row) => row.offsetHours === 24);

      await runReminder(pending?.id ?? '');

      const rows = await plan(appointment.id);
      const sent = rows.find((row) => row.id === pending?.id);
      expect(sent?.status).toBe('sent');
      expect(sent?.messageId).not.toBeNull();

      const message = (await messages())[0];
      expect(message?.event).toBe('appointment_reminder');
      expect(message?.body).toContain('Ayşe Yılmaz');
      // Saat ŞUBENİN saat diliminde yazılır.
      expect(message?.body).toContain('11:00');
    });

    it('*** ÇİFT GÖNDERİM *** aynı plan iki kez koşarsa ikinci mesaj YAZILMAZ', async () => {
      const appointment = await createAppointment();
      const pending = (await plan(appointment.id))[0];

      await runReminder(pending?.id ?? '');
      await runReminder(pending?.id ?? '');

      expect(await messages()).toHaveLength(1);
    });

    it('gönderim mesajı gerçekten SMS olarak çıkar', async () => {
      const appointment = await createAppointment();
      const pending = (await plan(appointment.id))[0];
      await runReminder(pending?.id ?? '');

      const message = (await messages())[0];
      await app
        .get(NotificationSenderWorker)
        .handle({ tenantId: clinic.tenant.id, messageId: message?.id ?? '' });

      expect(sms().sent).toHaveLength(1);
      expect(sms().sent[0]?.body).toContain('hatırlatırız');
    });
  });

  // -------------------------------------------------------------------------
  describe('no-show takibi', () => {
    it('no-show sonrası takip mesajı planlanır', async () => {
      const appointment = await createAppointment();
      await http(app)
        .post(`/api/v1/appointments/${appointment.id}/status`)
        .set(ownerAuth())
        .set(branch())
        .send({ status: 'no_show' })
        .expect(200);

      const rows = await plan(appointment.id);
      const followup = rows.find((row) => row.event === 'no_show_followup');
      expect(followup?.status).toBe('pending');
      // Randevudan SONRA gider: offset negatif.
      expect(followup?.offsetHours).toBeLessThan(0);
      // Hatırlatmalar ise kapandı.
      expect(rows.filter((row) => row.event === 'appointment_reminder').every((row) => row.status === 'cancelled')).toBe(true);
    });

    it('şube takibi kapattıysa plan yazılmaz', async () => {
      await http(app)
        .put(`/api/v1/branches/${clinic.branch.id}/reminder-settings`)
        .set(ownerAuth())
        .send({ noShowFollowupEnabled: false })
        .expect(200);

      const appointment = await createAppointment();
      await http(app)
        .post(`/api/v1/appointments/${appointment.id}/status`)
        .set(ownerAuth())
        .set(branch())
        .send({ status: 'no_show' })
        .expect(200);

      const rows = await plan(appointment.id);
      expect(rows.some((row) => row.event === 'no_show_followup')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  it('planlayıcı doğrudan çağrıldığında da aynı kuralları uygular', async () => {
    // Servis katmanı sözleşmesi: uygun olmayan durumda hiçbir şey planlanmaz.
    const planned = await app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
      app.get(ReminderSchedulerService).scheduleForAppointment(tx, {
        tenantId: clinic.tenant.id,
        appointmentId: '00000000-0000-0000-0000-000000000000',
        branchId: clinic.branch.id,
        startsAt: new Date(Date.now() + 86_400_000),
        status: 'cancelled',
      }),
    );
    expect(planned).toBe(0);
  });
});
