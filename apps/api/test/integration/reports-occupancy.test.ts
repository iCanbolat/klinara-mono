import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import {
  branchHeader,
  setupClinic,
  weeklyBranchHours,
  weeklyStaffSchedule,
  type ClinicFixture,
} from '../helpers/clinic';

interface OccupancyReport {
  scope: 'all' | 'own';
  totals: { bookedMinutes: number; availableMinutes: number; occupancyRate: number };
  data: {
    groupId: string | null;
    groupLabel: string;
    bookedMinutes: number;
    availableMinutes: number;
    occupancyRate: number;
  }[];
  previous?: { bookedMinutes: number; availableMinutes: number; occupancyRate: number };
  delta?: Record<string, number | null>;
}

// Query string'de kodlanmadan gönderilen `+03:00` offset'i BOŞLUĞA dönüşür ve
// ISO doğrulaması patlar (5.4'ün testinde öğrenildi).
const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

// 2026-09-07 Pazartesi. Tek bir günü ölçmek, hafta sonu ve tatil kurallarının
// beklenen sayıya karışmasını engelliyor.
const MONDAY = '2026-09-07';
const DAY_FROM = `${MONDAY}T00:00:00+03:00`;
const DAY_TO = '2026-09-08T00:00:00+03:00';

describe('doluluk raporu (Batch 10.1)', () => {
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

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);

  const occupancy = (query: string) =>
    http(app).get(`/api/v1/reports/occupancy?${query}`).set(ownerAuth());

  /** 09:00–18:00 açık, 13:00–14:00 mola → personel için 480 dk müsait. */
  const setupStandard = async () => {
    clinic = await setupClinic(app, {
      branchHours: weeklyBranchHours({ breakStartTime: '13:00', breakEndTime: '14:00' }),
      staffSchedule: weeklyStaffSchedule(),
    });
  };

  const book = (startsAt: string) =>
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

  describe('payda', () => {
    beforeEach(async () => {
      await database.truncateAll();
      await setupStandard();
    });

    it('mola paydadan düşülüyor — 9 saat açık, 1 saat mola → 480 dk', async () => {
      const res = await occupancy(range(DAY_FROM, DAY_TO));

      expect(res.status).toBe(200);
      const body = res.body as OccupancyReport;
      expect(body.totals.availableMinutes).toBe(480);
      // Hiç randevu yok: pay sıfır, ama personel raporda GÖRÜNÜYOR. Randevusuz
      // personelin satırdan düşmesi, doluluğu olduğundan yüksek gösterirdi.
      expect(body.totals.bookedMinutes).toBe(0);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.groupLabel).toBe('Demo Uygulayıcı');
    });

    it('personelin vardiyası şube saatleriyle KESİŞTİRİLİYOR', async () => {
      await database.truncateAll();
      // Personel 08:00–20:00 diyor ama şube 09:00–18:00 açık ve 1 saat mola
      // var. Kesişim olmasaydı payda 12 saat (720 dk) çıkardı.
      clinic = await setupClinic(app, {
        branchHours: weeklyBranchHours({ breakStartTime: '13:00', breakEndTime: '14:00' }),
        staffSchedule: weeklyStaffSchedule({ startTime: '08:00', endTime: '20:00' }),
      });

      const body = (await occupancy(range(DAY_FROM, DAY_TO))).body as OccupancyReport;
      expect(body.totals.availableMinutes).toBe(480);
    });

    it('personelin izin günü paydadan tamamen çıkıyor', async () => {
      await database.truncateAll();
      // Pazartesi (dow 1) izinli.
      clinic = await setupClinic(app, {
        branchHours: weeklyBranchHours(),
        staffSchedule: weeklyStaffSchedule({ offDays: [0, 1] }),
      });

      const body = (await occupancy(range(DAY_FROM, DAY_TO))).body as OccupancyReport;
      expect(body.totals.availableMinutes).toBe(0);
      expect(body.data).toHaveLength(0);
    });

    it('pencere gün ortasından başlıyorsa payda KIRPILIYOR', async () => {
      // 12:00'den itibaren: 12:00–13:00 (60) + 14:00–18:00 (240) = 300 dk.
      const body = (
        await occupancy(range(`${MONDAY}T12:00:00+03:00`, DAY_TO))
      ).body as OccupancyReport;
      expect(body.totals.availableMinutes).toBe(300);
    });
  });

  describe('pay', () => {
    beforeEach(async () => {
      await database.truncateAll();
      await setupStandard();
    });

    it('randevu BUFFER DAHİL sayılıyor', async () => {
      // `service` 60 dk + 5 dk hazırlık + 10 dk temizlik = 75 dk işgal.
      const created = await http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId: clinic.customer.id,
          startsAt: `${MONDAY}T10:00:00+03:00`,
          services: [
            { serviceId: clinic.service.id, staffProfileId: clinic.practitioner.staffProfileId },
          ],
        });
      expect(created.status).toBe(201);

      const body = (await occupancy(range(DAY_FROM, DAY_TO))).body as OccupancyReport;
      expect(body.totals.bookedMinutes).toBe(75);
      expect(body.totals.availableMinutes).toBe(480);
      expect(body.totals.occupancyRate).toBe(15.63);
    });

    it('iptal edilen randevu paydan DÜŞÜYOR', async () => {
      const created = await book(`${MONDAY}T10:00:00+03:00`);
      expect(created.status).toBe(201);
      const { id, version } = created.body as { id: string; version: number };

      const before = (await occupancy(range(DAY_FROM, DAY_TO))).body as OccupancyReport;
      expect(before.totals.bookedMinutes).toBe(30);

      const cancelled = await http(app)
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(ownerAuth())
        .set(branch())
        .set('if-match', `W/"${version}"`)
        .send({ reason: 'Müşteri vazgeçti' });
      expect(cancelled.status).toBe(200);

      // İptal `resource_bookings.active`i düşürüyor; rapor bunu ayrıca
      // bilmek zorunda değil, aynı gerçeği okuyor.
      const after = (await occupancy(range(DAY_FROM, DAY_TO))).body as OccupancyReport;
      expect(after.totals.bookedMinutes).toBe(0);
    });
  });

  describe('kırılım ve karşılaştırma', () => {
    beforeEach(async () => {
      await database.truncateAll();
      await setupStandard();
    });

    it('gün kırılımında `groupId` NULL ve etiket yerel tarih', async () => {
      await book(`${MONDAY}T10:00:00+03:00`);
      const body = (
        await occupancy(`${range(DAY_FROM, DAY_TO)}&groupBy=day`)
      ).body as OccupancyReport;

      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.groupId).toBeNull();
      expect(body.data[0]?.groupLabel).toBe(MONDAY);
    });

    it('şube kırılımı şube adını veriyor', async () => {
      const body = (
        await occupancy(`${range(DAY_FROM, DAY_TO)}&groupBy=branch`)
      ).body as OccupancyReport;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.groupId).toBe(clinic.branch.id);
    });

    it('`compareTo=previous` AYNI UZUNLUKTA önceki pencereyi ölçüyor', async () => {
      await book(`${MONDAY}T10:00:00+03:00`);
      const body = (
        await occupancy(`${range(DAY_FROM, DAY_TO)}&compareTo=previous`)
      ).body as OccupancyReport;

      expect(body.totals.bookedMinutes).toBe(30);
      // Önceki gün Pazar: şube kapalı, personel izinli → payda da sıfır.
      expect(body.previous?.availableMinutes).toBe(0);
      expect(body.previous?.bookedMinutes).toBe(0);
      // Önceki dönem sıfırken yüzde değişim KIYASLANAMAZ.
      expect(body.delta?.bookedMinutes).toBeNull();
    });
  });

  describe('kapsam', () => {
    beforeEach(async () => {
      await database.truncateAll();
      await setupStandard();
    });

    it('uygulayıcı YALNIZ kendi satırını görüyor ve kapsam `own`', async () => {
      const res = await http(app)
        .get(`/api/v1/reports/occupancy?${range(DAY_FROM, DAY_TO)}`)
        .set(auth(clinic.practitioner.tokens));

      expect(res.status).toBe(200);
      const body = res.body as OccupancyReport;
      expect(body.scope).toBe('own');
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.groupId).toBe(clinic.practitioner.staffProfileId);
    });

    it('uygulayıcının gönderdiği başka `staffProfileId` YOK SAYILIYOR', async () => {
      const res = await http(app)
        .get(
          `/api/v1/reports/occupancy?${range(DAY_FROM, DAY_TO)}` +
            `&staffProfileId=11111111-2222-4333-8444-555555555555`,
        )
        .set(auth(clinic.practitioner.tokens));

      expect(res.status).toBe(200);
      const body = res.body as OccupancyReport;
      // Üzerine yazılmıyor, HİÇ DİNLENMİYOR: kendi satırı dönüyor. Boş küme
      // dönseydi uygulayıcı sınırı deneyerek başkasının varlığını yoklardı.
      expect(body.data[0]?.groupId).toBe(clinic.practitioner.staffProfileId);
    });

    it('ters aralık 400', async () => {
      const res = await occupancy(range(DAY_TO, DAY_FROM));
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
    });
  });
});
