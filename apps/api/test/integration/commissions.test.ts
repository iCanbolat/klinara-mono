import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface AccrualBody {
  id: string;
  staffProfileId: string;
  periodId: string;
  triggerOn: string;
  basisMinor: number;
  amountMinor: number;
  reversesAccrualId: string | null;
}

interface PeriodBody {
  id: string;
  status: string;
  version: number;
}

interface ReportBody {
  rows: { staffProfileId: string; amountMinor: number; accrualCount: number }[];
  totalMinor: number;
}

interface Problem {
  code: string;
  status: number;
}

const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('personel primi (Batch 6.4)', () => {
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

  const createRule = (body: Record<string, unknown>) =>
    http(app)
      .post('/api/v1/commission-rules')
      .set(ownerAuth())
      .send({ name: 'Kural', calcKind: 'percent', value: 1000, ...body });

  const createAppointment = (startsAt: string) =>
    http(app)
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
      });

  const setStatus = (id: string, status: string) =>
    http(app)
      .post(`/api/v1/appointments/${id}/status`)
      .set(ownerAuth())
      .set(branch())
      .send({ status });

  const complete = async (id: string): Promise<void> => {
    for (const status of ['confirmed', 'arrived', 'in_progress', 'completed']) {
      const res = await setStatus(id, status);
      if (res.status !== 200) throw new Error(`${status}: ${res.status} ${res.text}`);
    }
  };

  const accruals = () =>
    http(app).get('/api/v1/commissions/accruals').set(ownerAuth());

  const listAccruals = async (): Promise<AccrualBody[]> =>
    (await accruals()).body ? ((await accruals()).body as { data: AccrualBody[] }).data : [];

  // -------------------------------------------------------------------------
  describe('kural çözümü', () => {
    it('aynı kapsam + öncelikte İKİNCİ aktif kural yazılamaz', async () => {
      const first = await createRule({ scope: 'global', priority: 10 });
      expect(first.status).toBe(201);

      const second = await createRule({ scope: 'global', priority: 10, value: 2000 });
      expect(second.status).toBe(409);
      expect((second.body as Problem).code).toBe('CONFLICT');
    });

    it('personel bazlı kural GENEL kuralı ezer', async () => {
      await createRule({ scope: 'global', value: 1000, priority: 0 });
      await createRule({
        scope: 'global',
        value: 3000,
        priority: 0,
        staffProfileId: clinic.practitioner.staffProfileId,
      });

      const created = await createAppointment(at('10:00'));
      await complete((created.body as { id: string }).id);

      const rows = await listAccruals();
      expect(rows).toHaveLength(1);
      // 50.000 × %30 = 15.000 (genel kural %10 olsaydı 5.000 olurdu).
      expect(rows[0]?.amountMinor).toBe(15_000);
    });

    it('hizmet kapsamlı kural genel kuralı ezer', async () => {
      await createRule({ scope: 'global', value: 1000 });
      await createRule({
        scope: 'service',
        scopeRefId: clinic.quickService.id,
        value: 2000,
      });

      const created = await createAppointment(at('11:00'));
      await complete((created.body as { id: string }).id);

      const rows = await listAccruals();
      expect(rows[0]?.amountMinor).toBe(10_000);
    });

    it('`collected_amount` matrahı tamamlama tetikleyicisiyle kullanılamaz', async () => {
      const res = await createRule({
        scope: 'global',
        basis: 'collected_amount',
        triggerOn: 'service_completed',
      });
      expect(res.status).toBe(422);
    });

    it('kural yoksa prim tahakkuk etmez', async () => {
      const created = await createAppointment(at('12:00'));
      await complete((created.body as { id: string }).id);

      expect(await listAccruals()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('tamamlama primi', () => {
    it('randevu tamamlanınca tahakkuk eder, geri alınca TERS KAYIT düşer', async () => {
      await createRule({ scope: 'global', value: 1000 });

      const created = await createAppointment(at('13:00'));
      const appointmentId = (created.body as { id: string }).id;
      await complete(appointmentId);

      const first = await listAccruals();
      expect(first).toHaveLength(1);
      expect(first[0]?.amountMinor).toBe(5_000);
      expect(first[0]?.triggerOn).toBe('service_completed');

      const reopened = await setStatus(appointmentId, 'in_progress');
      expect(reopened.status).toBe(200);

      const after = await listAccruals();
      expect(after).toHaveLength(2);
      const reversal = after.find((row) => row.reversesAccrualId !== null);
      expect(reversal?.amountMinor).toBe(-5_000);

      // Net prim SIFIR — ters kayıt negatif olduğu için ayrıca düşme adımı yok.
      const report = await http(app).get('/api/v1/reports/commissions').set(ownerAuth());
      expect((report.body as ReportBody).totalMinor).toBe(0);
    });

    it('aynı randevu iki kez tamamlanırsa prim İKİ KEZ yazılmaz', async () => {
      await createRule({ scope: 'global', value: 1000 });

      const created = await createAppointment(at('14:00'));
      const appointmentId = (created.body as { id: string }).id;
      await complete(appointmentId);
      await setStatus(appointmentId, 'in_progress');
      await setStatus(appointmentId, 'completed');

      const rows = await listAccruals();
      const positive = rows.filter((row) => row.amountMinor > 0);
      // İlk tahakkuk + geri alma sonrası yeniden tahakkuk = 2 pozitif, 1 ters.
      expect(positive).toHaveLength(2);
      const report = await http(app).get('/api/v1/reports/commissions').set(ownerAuth());
      expect((report.body as ReportBody).totalMinor).toBe(5_000);
    });
  });

  // -------------------------------------------------------------------------
  describe('tahsilat primi', () => {
    const setupPaidService = async (): Promise<string> => {
      await createRule({
        scope: 'global',
        value: 1000,
        basis: 'collected_amount',
        triggerOn: 'payment_received',
      });

      const created = await createAppointment(at('15:00'));
      const appointmentId = (created.body as { id: string }).id;
      await complete(appointmentId);

      const charges = await http(app)
        .get('/api/v1/charges?source=appointment_service')
        .set(ownerAuth());
      return (charges.body as { data: { id: string }[] }).data[0]!.id;
    };

    it('KISMİ tahsilat oransal prim üretir', async () => {
      const chargeId = await setupPaidService();

      const paid = await http(app)
        .post('/api/v1/payments')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          method: 'card',
          amountMinor: 20_000,
          allocations: [{ chargeId, amountMinor: 20_000 }],
        });
      expect(paid.status).toBe(201);

      const rows = await listAccruals();
      expect(rows).toHaveLength(1);
      // 20.000 × %10 = 2.000 (tam tahsilatta 5.000 olurdu).
      expect(rows[0]?.basisMinor).toBe(20_000);
      expect(rows[0]?.amountMinor).toBe(2_000);
    });

    it('parçalı tahsilatların toplamı, tek seferde tahsilatla AYNI primi verir', async () => {
      const chargeId = await setupPaidService();

      for (const amount of [20_000, 15_000, 15_000]) {
        const res = await http(app)
          .post('/api/v1/payments')
          .set(ownerAuth())
          .set(branch())
          .send({
            customerId: clinic.customer.id,
            method: 'card',
            amountMinor: amount,
            allocations: [{ chargeId, amountMinor: amount }],
          });
        expect(res.status).toBe(201);
      }

      const report = await http(app).get('/api/v1/reports/commissions').set(ownerAuth());
      // 50.000 × %10 = 5.000; parçalara bölmek kuruş kaybettirmiyor.
      expect((report.body as ReportBody).totalMinor).toBe(5_000);
    });

    it('tahsilat iptali primi TERS KAYITLA düşer', async () => {
      const chargeId = await setupPaidService();

      const paid = await http(app)
        .post('/api/v1/payments')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          method: 'card',
          amountMinor: 50_000,
          allocations: [{ chargeId, amountMinor: 50_000 }],
        });
      const payment = paid.body as { id: string; version: number };

      await http(app)
        .post(`/api/v1/payments/${payment.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${payment.version}"` })
        .send({ reason: 'Yanlış tahsilat' })
        .expect(200);

      const report = await http(app).get('/api/v1/reports/commissions').set(ownerAuth());
      expect((report.body as ReportBody).totalMinor).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('dönem kilidi', () => {
    it('kapatılmış döneme tahakkuk yazılamaz', async () => {
      await createRule({ scope: 'global', value: 1000 });

      const first = await createAppointment(at('16:00'));
      await complete((first.body as { id: string }).id);

      const periods = await http(app).get('/api/v1/commission-periods').set(ownerAuth());
      const period = (periods.body as PeriodBody[])[0]!;

      const closed = await http(app)
        .post(`/api/v1/commission-periods/${period.id}/close`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${period.version}"` })
        .send({});
      expect(closed.status).toBe(200);
      expect((closed.body as PeriodBody).status).toBe('closed');

      // Kapalı dönem yeniden kapatılamaz.
      const again = await http(app)
        .post(`/api/v1/commission-periods/${period.id}/close`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${(closed.body as PeriodBody).version}"` })
        .send({});
      expect(again.status).toBe(409);
      expect((again.body as Problem).code).toBe('PERIOD_CLOSED');

      // Kapalı dönem içindeyken yeni tahakkuk denemesi de reddedilir.
      const second = await createAppointment(at('17:00'));
      const res = await setStatus((second.body as { id: string }).id, 'confirmed');
      expect(res.status).toBe(200);
      const blocked = await (async () => {
        for (const status of ['arrived', 'in_progress', 'completed']) {
          const step = await setStatus((second.body as { id: string }).id, status);
          if (step.status !== 200) return step;
        }
        return undefined;
      })();
      expect(blocked?.status).toBe(409);
      expect((blocked?.body as Problem).code).toBe('PERIOD_CLOSED');
    });
  });

  // -------------------------------------------------------------------------
  describe('yetki ve değişmezlik', () => {
    it('muhasebe primi GÖRÜR ama kural yazamaz', async () => {
      const member = await inviteMember(app, clinic.owner.tokens, {
        email: `muhasebe@${clinic.tenant.slug}.test`,
        roleKey: 'accountant',
        fullName: 'Muhasebe',
      });
      const accountant: Tokens = member.tokens;

      const read = await http(app)
        .get('/api/v1/commissions/accruals')
        .set(auth(accountant));
      expect(read.status).toBe(200);

      const write = await http(app)
        .post('/api/v1/commission-rules')
        .set(auth(accountant))
        .send({ name: 'Kural', calcKind: 'percent', value: 1000 });
      expect(write.status).toBe(403);
    });

    it('tahakkuk satırı UPDATE/DELETE edilemez', async () => {
      await createRule({ scope: 'global', value: 1000 });
      const created = await createAppointment(at('15:30'));
      await complete((created.body as { id: string }).id);

      await expect(
        database.appPool.query('update commission_accruals set amount_minor = 1'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        database.appPool.query('delete from commission_accruals'),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
