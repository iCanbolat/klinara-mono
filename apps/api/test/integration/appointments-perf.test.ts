import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { countQueries } from '../helpers/query-count';

/**
 * Batch 10.2 — randevu OLUŞTURMA sıcak yolu.
 *
 * Takvim ve uygunluk için p95 testleri vardı; oluşturma için yoktu ve
 * hedefi (120 ms) ölçen hiçbir şey yoktu. Oluşturma diğer ikisinden farklı
 * bir yol: tek transaction içinde plan kurma, yetkinlik doğrulama, EXCLUDE
 * constraint'ine yazma, hatırlatma job'ı ve cache düşürme.
 *
 * Sayı ölçümü ile SÜRE ölçümü birlikte duruyor çünkü ikisi farklı şeyi
 * yakalıyor: sorgu sayısı ölçekten bağımsız bir regresyonu (kalem başına
 * sorgu) yakalar, süre ise sorgu sayısı sabit kalırken pahalılaşan bir planı.
 */

const MONDAY = '2026-09-07';

describe('randevu oluşturma performansı (Batch 10.2)', () => {
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
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);

  /** Dakika cinsinden ofsetten çakışmayan bir başlangıç üretir. */
  const at = (minutesFromNine: number): string => {
    const hour = 9 + Math.floor(minutesFromNine / 60);
    const minute = minutesFromNine % 60;
    return `${MONDAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`;
  };

  const create = (startsAt: string) =>
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
      });

  it('sorgu sayısı MEVCUT randevu sayısıyla büyümez', async () => {
    const counter = countQueries(app);
    try {
      // Isıtma: izin, şube ve katalog cache'leri dolsun. Isıtmadan ölçmek
      // ilk çağrıya cache doldurma maliyetini yükler ve karşılaştırmayı
      // anlamsız kılar.
      await create(at(0)).expect(201);

      counter.reset();
      await create(at(30)).expect(201);
      const onEmptyCalendar = counter.count;

      // Takvimi doldur: 200 randevu, hepsi aynı şubede ve aynı günde.
      await database.ownerPool.query(
        `with created as (
           insert into appointments (tenant_id, branch_id, customer_id, starts_at, ends_at)
           select $1, $2, $3,
                  timestamptz '2026-09-08 09:00:00+03' + (n * interval '2 minutes'),
                  timestamptz '2026-09-08 09:00:00+03' + (n * interval '2 minutes')
                    + interval '30 minutes'
             from generate_series(1, 200) n
           returning id, starts_at
         )
         insert into appointment_services (tenant_id, appointment_id, service_id,
                                           staff_profile_id, sort_order, starts_at, ends_at,
                                           duration_minutes, price_minor)
         select $1, created.id, $4, $5, 0, created.starts_at,
                created.starts_at + interval '30 minutes', 30, 50000
           from created`,
        [
          clinic.tenant.id,
          clinic.branch.id,
          clinic.customer.id,
          clinic.quickService.id,
          clinic.practitioner.staffProfileId,
        ],
      );
      await database.ownerPool.query('analyze');

      counter.reset();
      await create(at(60)).expect(201);
      const onBusyCalendar = counter.count;

      // ASIL İDDİA: sayı AYNI. Çakışma kontrolü uygulamada bir tarama değil,
      // veritabanındaki EXCLUDE constraint'idir; dolayısıyla mevcut randevu
      // sayısı sorgu sayısını etkileyemez. Etkiliyorsa biri "önce müsait mi
      // diye bak" desenine geri dönmüş demektir — ve o desen yarış koşulunda
      // yanlıştır (bkz. bölüm 5).
      expect(onBusyCalendar).toBe(onEmptyCalendar);
      expect(onBusyCalendar).toBeLessThan(25);
    } finally {
      counter.restore();
    }
  });

  it('dolu bir takvimde p95 120 ms altında kalır', async () => {
    await database.ownerPool.query(
      `with created as (
         insert into appointments (tenant_id, branch_id, customer_id, starts_at, ends_at)
         select $1, $2, $3,
                timestamptz '2026-09-08 09:00:00+03' + (n * interval '2 minutes'),
                timestamptz '2026-09-08 09:00:00+03' + (n * interval '2 minutes')
                  + interval '30 minutes'
           from generate_series(1, 500) n
         returning id, starts_at
       )
       insert into appointment_services (tenant_id, appointment_id, service_id,
                                         staff_profile_id, sort_order, starts_at, ends_at,
                                         duration_minutes, price_minor)
       select $1, created.id, $4, $5, 0, created.starts_at,
              created.starts_at + interval '30 minutes', 30, 50000
         from created`,
      [
        clinic.tenant.id,
        clinic.branch.id,
        clinic.customer.id,
        clinic.quickService.id,
        clinic.practitioner.staffProfileId,
      ],
    );
    await database.ownerPool.query('analyze');

    // İlk çağrı ısıtma; ölçüme girmiyor.
    await create(at(0)).expect(201);

    const durations: number[] = [];
    for (let run = 1; run <= 10; run += 1) {
      const started = performance.now();
      const res = await create(at(run * 30));
      durations.push(performance.now() - started);
      expect(res.status).toBe(201);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
    expect(p95).toBeLessThan(120);
  });
});
