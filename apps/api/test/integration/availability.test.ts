import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import {
  branchHeader,
  setupClinic,
  weeklyBranchHours,
  weeklyStaffSchedule,
  type ClinicFixture,
} from '../helpers/clinic';
import { createAppointment, tenantCtx } from '../helpers/booking';
import { DRIZZLE, type Database } from '../../src/database/database.constants';
import { AvailabilityCacheService } from '../../src/modules/booking/availability-cache.service';

interface SlotBody {
  startsAt: string;
  endsAt: string;
  staffProfileIds: string[];
}
interface AvailabilityBody {
  branchId: string;
  timezone: string;
  slotGranularityMinutes: number;
  slots: SlotBody[];
}

/** Sabit bir Pazartesi — testler takvimin kendisini sınıyor, bugünü değil. */
const MONDAY = '2026-09-07';
const at = (hhmm: string, day = MONDAY) => new Date(`${day}T${hhmm}:00+03:00`);

describe('uygunluk motoru (Batch 3.2)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let db: Database;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app);
  });

  const ask = async (
    overrides: Record<string, unknown> = {},
    tokens = clinic.owner.tokens,
  ): Promise<{ status: number; body: AvailabilityBody }> => {
    const res = await http(app)
      .get('/api/v1/availability')
      .query({
        branchId: clinic.branch.id,
        serviceIds: clinic.quickService.id,
        from: `${MONDAY}T00:00:00+03:00`,
        to: `${MONDAY}T23:59:59+03:00`,
        ...overrides,
      })
      .set(auth(tokens))
      .set(branchHeader(clinic.branch.id));
    return { status: res.status, body: res.body as AvailabilityBody };
  };

  // -------------------------------------------------------------------------
  describe('slot ızgarası', () => {
    it('çalışma saatlerini 15 dakikalık ızgaraya böler', async () => {
      const { status, body } = await ask();

      expect(status).toBe(200);
      expect(body.timezone).toBe('Europe/Istanbul');
      expect(body.slotGranularityMinutes).toBe(15);

      // 09:00–18:00 arası 30 dk’lık hizmet: 09:00 … 17:30 = 35 slot.
      expect(body.slots).toHaveLength(35);
      expect(body.slots[0]?.startsAt).toBe('2026-09-07T09:00:00+03:00');
      expect(body.slots[0]?.endsAt).toBe('2026-09-07T09:30:00+03:00');
      expect(body.slots.at(-1)?.startsAt).toBe('2026-09-07T17:30:00+03:00');
      expect(body.slots[0]?.staffProfileIds).toEqual([clinic.practitioner.staffProfileId]);
    });

    it('buffer’lı hizmette blok GÖRÜNEN süreye göre kapanır', async () => {
      // 60 dk hizmet + 5 hazırlık + 10 temizlik. Son slot 17:00 olmalı:
      // görünen bitiş 18:00'de kapanışa dayanır.
      const { body } = await ask({ serviceIds: clinic.service.id });

      expect(body.slots).toHaveLength(33);
      expect(body.slots[0]?.startsAt).toBe('2026-09-07T09:00:00+03:00');
      expect(body.slots.at(-1)?.startsAt).toBe('2026-09-07T17:00:00+03:00');
      expect(body.slots.at(-1)?.endsAt).toBe('2026-09-07T18:00:00+03:00');
    });

    it('ardışık iki hizmette toplam süre KESİNTİSİZ blok olarak aranır', async () => {
      const { body } = await ask({
        serviceIds: [clinic.service.id, clinic.quickService.id].join(','),
      });

      // 5 + 60 + 10 (ilk) + 0 + 30 + 0 (ikinci) = 105 dk işgal,
      // görünen süre 105 - 5 - 0 = 100 dk.
      expect(body.slots[0]?.startsAt).toBe('2026-09-07T09:00:00+03:00');
      expect(body.slots[0]?.endsAt).toBe('2026-09-07T10:40:00+03:00');
      // Izgara 15 dk: 100 dk'lık blok 18:00'e TAM oturmaz. 16:30 başlangıcı
      // 18:10'da biterdi, o yüzden son slot 16:15–17:55'tir.
      expect(body.slots.at(-1)?.startsAt).toBe('2026-09-07T16:15:00+03:00');
      expect(body.slots.at(-1)?.endsAt).toBe('2026-09-07T17:55:00+03:00');
    });

    it('mola aralığına denk gelen slotlar çıkarılır', async () => {
      await http(app)
        .put(`/api/v1/branches/${clinic.branch.id}/hours`)
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({ entries: weeklyBranchHours({ breakStartTime: '13:00', breakEndTime: '14:00' }) })
        .expect(200);

      const { body } = await ask();
      const starts = body.slots.map((slot) => slot.startsAt.slice(11, 16));

      expect(starts).toContain('12:30');
      expect(starts).not.toContain('12:45'); // 12:45–13:15 molaya taşar
      expect(starts).not.toContain('13:30');
      expect(starts).toContain('14:00');
    });

    it('kapalı günde slot üretmez', async () => {
      const { body } = await ask({
        from: '2026-09-06T00:00:00+03:00', // Pazar
        to: '2026-09-06T23:59:59+03:00',
      });
      expect(body.slots).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('mevcut işgal', () => {
    it('dolu aralığı ve BUFFER gölgesini uygunluktan çıkarır', async () => {
      await createAppointment(db, tenantCtx(clinic.tenant.id, clinic.owner.userId), {
        branchId: clinic.branch.id,
        customerId: clinic.customer.id,
        serviceId: clinic.service.id,
        staffProfileId: clinic.practitioner.staffProfileId,
        startsAt: at('11:00'),
        endsAt: at('12:00'),
        bufferBeforeMinutes: 5,
        bufferAfterMinutes: 10,
      });

      const { body } = await ask();
      const starts = body.slots.map((slot) => slot.startsAt.slice(11, 16));

      // Takvimde 10:55–12:10 dolu. 30 dk'lık hizmet için 10:30 slotu
      // 11:00'de biter ve 10:55'e DEĞER — son müsait slot 10:15'tir.
      expect(starts).toContain('10:15');
      expect(starts).not.toContain('10:30');
      expect(starts).not.toContain('10:45');
      expect(starts).not.toContain('11:45');
      expect(starts).not.toContain('12:00');
      expect(starts).toContain('12:15');
    });

    it('iptal edilen randevunun slotları geri gelir', async () => {
      const ctx = tenantCtx(clinic.tenant.id, clinic.owner.userId);
      const id = await createAppointment(db, ctx, {
        branchId: clinic.branch.id,
        customerId: clinic.customer.id,
        serviceId: clinic.quickService.id,
        staffProfileId: clinic.practitioner.staffProfileId,
        startsAt: at('11:00'),
        endsAt: at('11:30'),
      });

      const before = await ask();
      expect(before.body.slots.map((s) => s.startsAt.slice(11, 16))).not.toContain('11:00');

      const { setStatus } = await import('../helpers/booking');
      await setStatus(db, ctx, id, 'cancelled');

      // Bu test motoru sınıyor, cache'i değil: iptali HAM SQL ile yaptığımız
      // için servis katmanının invalidasyonu devreye girmez. Uçlar üzerinden
      // yapılan iptalde invalidasyon Batch 3.3'te sınanıyor.
      app.get(AvailabilityCacheService).clear();

      const after = await ask();
      expect(after.body.slots.map((s) => s.startsAt.slice(11, 16))).toContain('11:00');
    });
  });

  // -------------------------------------------------------------------------
  describe('yetkinlik ve çalışma takvimi', () => {
    it('yetkin OLMAYAN personel aday listesinde çıkmaz', async () => {
      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
        .set(auth(clinic.owner.tokens))
        .send({ services: [{ serviceId: clinic.service.id, branchId: clinic.branch.id }] })
        .expect(200);

      const forQuick = await ask({ serviceIds: clinic.quickService.id });
      expect(forQuick.body.slots).toHaveLength(0);

      const forFull = await ask({ serviceIds: clinic.service.id });
      expect(forFull.body.slots.length).toBeGreaterThan(0);
    });

    it('ardışık hizmetlerin HEPSİNDE yetkin olmayan personel aday olmaz', async () => {
      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
        .set(auth(clinic.owner.tokens))
        .send({ services: [{ serviceId: clinic.service.id, branchId: clinic.branch.id }] })
        .expect(200);

      const { body } = await ask({
        serviceIds: [clinic.service.id, clinic.quickService.id].join(','),
      });
      expect(body.slots).toHaveLength(0);
    });

    it('personelin özel süresi slot bloğunu değiştirir', async () => {
      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
        .set(auth(clinic.owner.tokens))
        .send({
          services: [
            {
              serviceId: clinic.quickService.id,
              branchId: clinic.branch.id,
              customDurationMinutes: 45,
            },
          ],
        })
        .expect(200);

      const { body } = await ask();
      expect(body.slots[0]?.endsAt).toBe('2026-09-07T09:45:00+03:00');
    });

    it('personelin izinli günü tüm slotları kapatır', async () => {
      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/schedule`)
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({
          branchId: clinic.branch.id,
          entries: weeklyStaffSchedule({ offDays: [0, 1] }),
        })
        .expect(200);

      const { body } = await ask();
      expect(body.slots).toHaveLength(0);
    });

    it('tek seferlik istisna o aralığı kapatır', async () => {
      await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({
          staffProfileId: clinic.practitioner.staffProfileId,
          branchId: clinic.branch.id,
          startsAt: `${MONDAY}T13:00:00+03:00`,
          endsAt: `${MONDAY}T15:00:00+03:00`,
          reason: 'Eğitim',
        })
        .expect(201);

      const { body } = await ask();
      const starts = body.slots.map((slot) => slot.startsAt.slice(11, 16));

      expect(starts).toContain('12:30');
      expect(starts).not.toContain('13:00');
      expect(starts).not.toContain('14:30');
      expect(starts).toContain('15:00');
    });

    it('HAFTALIK tekrarlı istisna sonraki haftalarda da kapatır', async () => {
      // İlk oluşum 31 Ağustos Pazartesi; iki hafta sonrası 14 Eylül.
      await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({
          staffProfileId: clinic.practitioner.staffProfileId,
          branchId: clinic.branch.id,
          startsAt: '2026-08-31T10:00:00+03:00',
          endsAt: '2026-08-31T11:00:00+03:00',
          recurrenceType: 'weekly',
          recurrenceIntervalWeeks: 1,
          recurrenceWeekdays: [1],
          recurrenceUntil: '2026-12-31T00:00:00+03:00',
        })
        .expect(201);

      const { body } = await ask();
      const starts = body.slots.map((slot) => slot.startsAt.slice(11, 16));

      expect(starts).not.toContain('10:00');
      expect(starts).not.toContain('10:30');
      expect(starts).toContain('11:00');
    });

    it('resmî tatil günü kapatır', async () => {
      // Tatili doğrudan yazıyoruz: `holidays` için Faz 2'de bir uç
      // tanımlanmadı (seed'den geliyor), motorun onu okuduğunu yine de
      // kanıtlamalıyız.
      await database.ownerPool.query(
        `insert into holidays (tenant_id, branch_id, holiday_date, name, is_closed)
         values ($1, null, $2, 'Test Tatili', true)`,
        [clinic.tenant.id, MONDAY],
      );

      const { body } = await ask();
      expect(body.slots).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('pencere kuralları', () => {
    it('minimum önden süre yakın slotları eler', async () => {
      await http(app)
        .patch('/api/v1/tenant/settings')
        .set(auth(clinic.owner.tokens))
        .send({ maxAdvanceDays: 3 })
        .expect(200);

      const { body } = await ask();
      // MONDAY bugünden çok ileride; 3 günlük sınır her şeyi eler.
      expect(body.slots).toHaveLength(0);
    });

    it('31 günden uzun pencereyi reddeder', async () => {
      const res = await http(app)
        .get('/api/v1/availability')
        .query({
          branchId: clinic.branch.id,
          serviceIds: clinic.quickService.id,
          from: '2026-09-01T00:00:00+03:00',
          to: '2026-11-01T00:00:00+03:00',
        })
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id));

      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe('yaz saati (DST)', () => {
    it('geçiş gününde yerel saat KAYMAZ, offset değişir', async () => {
      const ownerAuth = auth(clinic.owner.tokens);

      // Türkiye kalıcı UTC+3'tedir; DST doğruluğunu sınamak için yaz saati
      // uygulayan bir şube kuruyoruz. 25 Ekim 2026 Berlin'de saatlerin geri
      // alındığı gündür (CEST +02:00 → CET +01:00).
      const created = await http(app)
        .post('/api/v1/branches')
        .set(ownerAuth)
        .send({ slug: 'berlin', name: 'Berlin Şube', timezone: 'Europe/Berlin' });
      expect(created.status).toBe(201);
      const berlinId = (created.body as { id: string }).id;

      await http(app)
        .put(`/api/v1/branches/${berlinId}/hours`)
        .set(ownerAuth)
        .set(branchHeader(berlinId))
        .send({ entries: weeklyBranchHours({ closedDays: [] }) })
        .expect(200);

      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/schedule`)
        .set(ownerAuth)
        .set(branchHeader(berlinId))
        .send({ branchId: berlinId, entries: weeklyStaffSchedule({ offDays: [] }) })
        .expect(200);

      // Yetkinliği kiracı geneli yapıyoruz ki Berlin şubesini de kapsasın.
      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
        .set(ownerAuth)
        .send({ services: [{ serviceId: clinic.quickService.id }] })
        .expect(200);

      const query = (from: string, to: string) =>
        http(app)
          .get('/api/v1/availability')
          .query({ branchId: berlinId, serviceIds: clinic.quickService.id, from, to })
          .set(ownerAuth)
          .set(branchHeader(berlinId));

      const before = await query('2026-10-23T00:00:00+02:00', '2026-10-23T23:59:59+02:00');
      const after = await query('2026-10-25T00:00:00+02:00', '2026-10-25T23:59:59+01:00');

      const firstBefore = (before.body as AvailabilityBody).slots[0];
      const firstAfter = (after.body as AvailabilityBody).slots[0];

      // Yerel saat iki günde de 09:00 — kayma YOK.
      expect(firstBefore?.startsAt).toBe('2026-10-23T09:00:00+02:00');
      expect(firstAfter?.startsAt).toBe('2026-10-25T09:00:00+01:00');

      // Aynı sayıda slot: geçiş günü de normal bir iş günüdür.
      expect((after.body as AvailabilityBody).slots).toHaveLength(
        (before.body as AvailabilityBody).slots.length,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('cache', () => {
    it('uçlar üzerinden yapılan yazım cache’i düşürür', async () => {
      const first = await ask();
      expect(first.body.slots).toHaveLength(35);

      // Şube saatlerini daraltıyoruz. Cache invalidasyonu olmasaydı ikinci
      // sorgu 30 saniye boyunca ESKİ takvimi göstermeye devam ederdi —
      // kullanıcıya kapanmış saatlerde boş slot vaat etmek demekti.
      await http(app)
        .put(`/api/v1/branches/${clinic.branch.id}/hours`)
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({ entries: weeklyBranchHours({ openTime: '09:00', closeTime: '12:00' }) })
        .expect(200);

      const second = await ask();
      expect(second.body.slots).toHaveLength(11);
    });

    it('yetkinlik değişimi de cache’i düşürür', async () => {
      expect((await ask()).body.slots.length).toBeGreaterThan(0);

      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
        .set(auth(clinic.owner.tokens))
        .send({ services: [] })
        .expect(200);

      expect((await ask()).body.slots).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('performans', () => {
    it('30 günlük pencerede dolu bir takvimi 200 ms altında çözer', async () => {
      const ownerAuth = auth(clinic.owner.tokens);

      // Üç personel: aday kümesi hesabı gerçekten çalışsın.
      const staffIds = [clinic.practitioner.staffProfileId];
      for (const suffix of ['iki', 'uc']) {
        const member = await inviteMember(app, clinic.owner.tokens, {
          email: `uygulayici-${suffix}@demo-klinik.test`,
          roleKey: 'practitioner',
          branchId: clinic.branch.id,
          fullName: `Uygulayıcı ${suffix}`,
        });
        const created = await http(app)
          .post('/api/v1/staff')
          .set(ownerAuth)
          .send({
            userId: member.userId,
            primaryBranchId: clinic.branch.id,
            services: [{ serviceId: clinic.quickService.id, branchId: clinic.branch.id }],
          });
        expect(created.status).toBe(201);
        const id = (created.body as { id: string }).id;
        staffIds.push(id);

        await http(app)
          .put(`/api/v1/staff/${id}/schedule`)
          .set(ownerAuth)
          .set(branchHeader(clinic.branch.id))
          .send({ branchId: clinic.branch.id, entries: weeklyStaffSchedule() })
          .expect(200);
      }

      // Her personel için 30 gün boyunca günde 6 dolu blok (~540 satır).
      // `hold` kaynağı seçildi: EXCLUDE constraint ve GiST indeksi randevu
      // makinesini kurmadan tam olarak aynı yükü görür.
      //
      // Batch 9.1'den beri `resource_bookings.hold_id` GERÇEK bir `slot_holds`
      // satırına bakmak zorunda (FK 0037'de kapandı). Personel başına tek bir
      // çapa hold açıyoruz: yükü taşıyan şey `resource_bookings` satır sayısı,
      // hold sayısı değil — bu fixture uygunluk sorgusunu ölçüyor, tutma
      // semantiğini değil.
      const siteId = (
        await database.ownerPool.query<{ id: string }>(
          `insert into booking_sites (tenant_id, slug) values ($1, $2) returning id`,
          [clinic.tenant.id, clinic.tenant.slug],
        )
      ).rows[0]!.id;

      for (const staffId of staffIds) {
        const holdId = (
          await database.ownerPool.query<{ id: string }>(
            `insert into slot_holds
               (tenant_id, branch_id, booking_site_id, token_hash, service_ids,
                staff_profile_id, starts_at, ends_at, expires_at)
             values ($1, $2, $3, encode(sha256($4::bytea), 'hex'), array[$5::uuid], $6,
                     timestamptz '2026-09-01 09:00:00+03',
                     timestamptz '2026-09-30 18:00:00+03',
                     now() + interval '1 hour')
             returning id`,
            [
              clinic.tenant.id,
              clinic.branch.id,
              siteId,
              `perf-${staffId}`,
              clinic.service.id,
              staffId,
            ],
          )
        ).rows[0]!.id;

        await database.ownerPool.query(
          `insert into resource_bookings
             (tenant_id, branch_id, resource_type, resource_id, source_type, hold_id, time_range)
           select $1, $2, 'staff', $3, 'hold', $4,
                  tstzrange(slot, slot + interval '45 minutes', '[)')
             from generate_series(
                    timestamptz '2026-09-01 09:00:00+03',
                    timestamptz '2026-09-30 09:00:00+03',
                    interval '1 day') d
             cross join lateral (
               select d + (h || ' hours')::interval as slot
                 from generate_series(0, 5) h
             ) s`,
          [clinic.tenant.id, clinic.branch.id, staffId, holdId],
        );
      }

      const cache = app.get(AvailabilityCacheService);
      const durations: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        cache.clear();
        const started = performance.now();
        const res = await http(app)
          .get('/api/v1/availability')
          .query({
            branchId: clinic.branch.id,
            serviceIds: clinic.quickService.id,
            from: '2026-09-01T00:00:00+03:00',
            to: '2026-09-30T00:00:00+03:00',
          })
          .set(ownerAuth)
          .set(branchHeader(clinic.branch.id));
        durations.push(performance.now() - started);
        expect(res.status).toBe(200);
        expect((res.body as AvailabilityBody).slots.length).toBeGreaterThan(100);
      }

      durations.sort((a, b) => a - b);
      const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
      expect(p95).toBeLessThan(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('yetki', () => {
    it('uygulayıcı da uygunluk sorabilir (read.own yeterlidir)', async () => {
      const { status, body } = await ask({}, clinic.practitioner.tokens);
      expect(status).toBe(200);
      expect(body.slots.length).toBeGreaterThan(0);
    });
  });
});
