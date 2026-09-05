import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface StaffPerformanceReport {
  scope: 'all' | 'own';
  data: {
    staffProfileId: string;
    staffName: string;
    completedServices: number;
    revenueMinor: number;
    commissionMinor: number;
    bookedMinutes: number;
    occupancyRate: number;
  }[];
}

interface NoShowReport {
  totals: {
    total: number;
    completed: number;
    noShow: number;
    cancelled: number;
    noShowRate: number;
    cancellationRate: number;
  };
  data: { groupLabel: string; total: number; noShow: number }[];
  byOrigin: { origin: string; total: number; noShow: number }[];
}

interface RetentionReport {
  totals: {
    newCustomers: number;
    returningCustomers: number;
    activeCustomers: number;
    returningRate: number;
  };
  acquisition: { source: string | null; customers: number }[];
  cohorts: { withinDays: number; returned: number; rate: number }[];
}

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

const MONDAY = '2026-09-07';
const WEEK = range('2026-09-07T00:00:00+03:00', '2026-09-14T00:00:00+03:00');

describe('performans, no-show ve retention raporları (Batch 10.1)', () => {
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

  const book = async (startsAt: string): Promise<{ id: string; version: number }> => {
    const res = await http(app)
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
    if (res.status !== 201) throw new Error(`Randevu açılamadı: ${res.status} ${res.text}`);
    return res.body as { id: string; version: number };
  };

  const setStatus = async (id: string, status: string): Promise<void> => {
    const res = await http(app)
      .post(`/api/v1/appointments/${id}/status`)
      .set(ownerAuth())
      .set(branch())
      .send({ status });
    if (res.status !== 200) throw new Error(`${status}: ${res.status} ${res.text}`);
  };

  /** `scheduled` → `completed`; ara durumlar zorunlu. */
  const complete = async (id: string): Promise<void> => {
    for (const status of ['confirmed', 'arrived', 'in_progress', 'completed']) {
      await setStatus(id, status);
    }
  };

  const markNoShow = (id: string) => setStatus(id, 'no_show');

  // ---------------------------------------------------------------------------
  describe('personel performansı', () => {
    it('tamamlanan hizmeti ve `charges` üzerinden ciroyu sayıyor', async () => {
      const appointment = await book(`${MONDAY}T10:00:00+03:00`);
      await complete(appointment.id);

      const res = await http(app)
        .get(`/api/v1/reports/staff-performance?${WEEK}`)
        .set(ownerAuth());

      expect(res.status).toBe(200);
      const body = res.body as StaffPerformanceReport;
      const row = body.data.find(
        (item) => item.staffProfileId === clinic.practitioner.staffProfileId,
      );
      expect(row?.completedServices).toBe(1);
      // `quickService` 50.000 kuruş; tamamlanma ücret kalemini üretiyor.
      expect(row?.revenueMinor).toBe(50_000);
      expect(row?.bookedMinutes).toBe(30);
    });

    it('tamamlanmamış randevu ciroya ve işlem sayısına GİRMİYOR', async () => {
      await book(`${MONDAY}T10:00:00+03:00`);

      const body = (
        await http(app).get(`/api/v1/reports/staff-performance?${WEEK}`).set(ownerAuth())
      ).body as StaffPerformanceReport;

      const row = body.data.find(
        (item) => item.staffProfileId === clinic.practitioner.staffProfileId,
      );
      expect(row?.completedServices).toBe(0);
      expect(row?.revenueMinor).toBe(0);
      // Ama personel raporda DURUYOR: randevusu var, doluluğu var. Satırın
      // düşmesi "bu personel hiç çalışmadı" demek olurdu.
      expect(row?.bookedMinutes).toBe(30);
    });

    it('uygulayıcı KENDİ satırına kilitleniyor ve kapsam `own`', async () => {
      const appointment = await book(`${MONDAY}T10:00:00+03:00`);
      await complete(appointment.id);

      const res = await http(app)
        .get(
          `/api/v1/reports/staff-performance?${WEEK}` +
            `&staffProfileId=11111111-2222-4333-8444-555555555555`,
        )
        .set(auth(clinic.practitioner.tokens));

      expect(res.status).toBe(200);
      const body = res.body as StaffPerformanceReport;
      expect(body.scope).toBe('own');
      expect(body.data).toHaveLength(1);
      // Gönderilen yabancı kimlik ÜZERİNE YAZILMIYOR, hiç dinlenmiyor.
      expect(body.data[0]?.staffProfileId).toBe(clinic.practitioner.staffProfileId);
      expect(body.data[0]?.revenueMinor).toBe(50_000);
    });
  });

  describe('no-show', () => {
    it('oran RANDEVU grain\'inde ve iptal ayrı sayılıyor', async () => {
      const first = await book(`${MONDAY}T10:00:00+03:00`);
      await complete(first.id);

      const second = await book(`${MONDAY}T11:00:00+03:00`);
      await markNoShow(second.id);

      const third = await book(`${MONDAY}T12:00:00+03:00`);
      const cancelled = await http(app)
        .post(`/api/v1/appointments/${third.id}/cancel`)
        .set(ownerAuth())
        .set(branch())
        .set('if-match', `W/"${third.version}"`)
        .send({ reason: 'Müşteri vazgeçti' });
      expect(cancelled.status).toBe(200);

      const body = (
        await http(app).get(`/api/v1/reports/no-show?${WEEK}`).set(ownerAuth())
      ).body as NoShowReport;

      expect(body.totals.total).toBe(3);
      expect(body.totals.completed).toBe(1);
      expect(body.totals.noShow).toBe(1);
      expect(body.totals.cancelled).toBe(1);
      expect(body.totals.noShowRate).toBe(33.33);
      expect(body.totals.cancellationRate).toBe(33.33);
    });

    it('`byOrigin` iç randevuyu `internal` olarak ayırıyor', async () => {
      const appointment = await book(`${MONDAY}T10:00:00+03:00`);
      await markNoShow(appointment.id);

      const body = (
        await http(app).get(`/api/v1/reports/no-show?${WEEK}`).set(ownerAuth())
      ).body as NoShowReport;

      expect(body.byOrigin).toHaveLength(1);
      expect(body.byOrigin[0]?.origin).toBe('internal');
      expect(body.byOrigin[0]?.noShow).toBe(1);
    });
  });

  describe('retention', () => {
    it('YENİ müşteri, kayıt tarihine değil ilk TAMAMLANMIŞ randevuya göre', async () => {
      const appointment = await book(`${MONDAY}T10:00:00+03:00`);

      // Henüz tamamlanmadı: müşteri kayıtlı ama "kazanılmış" değil.
      const before = (
        await http(app).get(`/api/v1/reports/retention?${WEEK}`).set(ownerAuth())
      ).body as RetentionReport;
      expect(before.totals.activeCustomers).toBe(0);
      expect(before.totals.newCustomers).toBe(0);

      await complete(appointment.id);

      const after = (
        await http(app).get(`/api/v1/reports/retention?${WEEK}`).set(ownerAuth())
      ).body as RetentionReport;
      expect(after.totals.activeCustomers).toBe(1);
      expect(after.totals.newCustomers).toBe(1);
      expect(after.totals.returningCustomers).toBe(0);
    });

    it('aynı pencerede ikinci ziyaret 30 günlük kohorta düşüyor', async () => {
      const first = await book(`${MONDAY}T10:00:00+03:00`);
      await complete(first.id);
      const second = await book('2026-09-09T10:00:00+03:00');
      await complete(second.id);

      const body = (
        await http(app).get(`/api/v1/reports/retention?${WEEK}`).set(ownerAuth())
      ).body as RetentionReport;

      // Müşteri hâlâ TEK: "aktif" müşteri sayısı ziyaret sayısı değil.
      expect(body.totals.activeCustomers).toBe(1);
      expect(body.totals.newCustomers).toBe(1);

      const cohort30 = body.cohorts.find((item) => item.withinDays === 30);
      expect(cohort30?.returned).toBe(1);
      expect(cohort30?.rate).toBe(100);
    });

    it('yanıt müşteri KİMLİĞİ taşımıyor', async () => {
      const appointment = await book(`${MONDAY}T10:00:00+03:00`);
      await complete(appointment.id);

      const res = await http(app).get(`/api/v1/reports/retention?${WEEK}`).set(ownerAuth());
      // Rapor toplu bir sayıdır; içinden tek tek müşteriye inilememeli.
      expect(JSON.stringify(res.body)).not.toContain(clinic.customer.id);
    });
  });
});
