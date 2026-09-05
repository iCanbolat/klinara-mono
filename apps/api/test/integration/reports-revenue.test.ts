import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface RevenueReport {
  scope: 'all' | 'own';
  totals: {
    accruedMinor: number;
    collectedMinor: number;
    refundedMinor: number;
    currency: string;
  };
  data: { groupId: string | null; groupLabel: string; accruedMinor: number; collectedMinor: number }[];
  previous?: { accruedMinor: number; collectedMinor: number };
  delta?: Record<string, number | null>;
}

interface PaymentListItem {
  id: string;
  amountMinor: number;
  status: string;
}

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

// Pencere fixture'ın tamamını kapsıyor: kalemler ve tahsilatlar `now()` ile
// yazılıyor, dolayısıyla sabit bir gün seçmek testi kırılgan yapardı.
const WIDE_FROM = '2020-01-01T00:00:00+03:00';
const WIDE_TO = '2099-01-01T00:00:00+03:00';

describe('ciro raporu (Batch 10.1)', () => {
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

  const revenue = (query = range(WIDE_FROM, WIDE_TO)) =>
    http(app).get(`/api/v1/reports/revenue?${query}`).set(ownerAuth());

  const createCharge = async (amountMinor: number, description: string): Promise<string> => {
    const res = await http(app)
      .post('/api/v1/charges')
      .set(ownerAuth())
      .set(branch())
      .send({
        customerId: clinic.customer.id,
        source: 'manual',
        description,
        unitPriceMinor: amountMinor,
      });
    if (res.status !== 201) throw new Error(`Kalem açılamadı: ${res.status} ${res.text}`);
    return (res.body as { id: string }).id;
  };

  const pay = (body: Record<string, unknown>) =>
    http(app)
      .post('/api/v1/payments')
      .set(ownerAuth())
      .set(branch())
      .send({ customerId: clinic.customer.id, method: 'card', ...body });

  // ---------------------------------------------------------------------------
  describe('UZLAŞMA — raporun asıl kabul kriteri', () => {
    it('rapor tahsilat toplamı, `GET /payments` toplamıyla BİREBİR aynı', async () => {
      // Karışık bir gün: üç kalem, kısmi ve tam tahsilatlar, biri iptal.
      await createCharge(30_000, 'Kalem A');
      await createCharge(70_000, 'Kalem B');
      await createCharge(45_000, 'Kalem C');

      expect((await pay({ amountMinor: 25_000 })).status).toBe(201);
      expect((await pay({ amountMinor: 60_000 })).status).toBe(201);
      const voided = await pay({ amountMinor: 40_000 });
      expect(voided.status).toBe(201);

      const voidedBody = voided.body as { id: string; version: number };
      const voidRes = await http(app)
        .post(`/api/v1/payments/${voidedBody.id}/void`)
        .set(ownerAuth())
        .set(branch())
        // İyimser kilit ZORUNLU (5.7): başlıksız istek 428 döner.
        .set('if-match', `W/"${voidedBody.version}"`)
        .send({ reason: 'Yanlış tutar girildi' });
      expect(voidRes.status).toBe(200);

      const payments = await http(app).get('/api/v1/payments').set(ownerAuth()).set(branch());
      expect(payments.status).toBe(200);
      const postedTotal = (payments.body as { data: PaymentListItem[] }).data
        .filter((payment) => payment.status === 'posted')
        .reduce((total, payment) => total + payment.amountMinor, 0);

      const report = (await revenue()).body as RevenueReport;

      // Batch 10.1'in kabul kriteri tam olarak bu satır: rapor toplamı =
      // tahsilat toplamı. İki sorgu farklı yollardan gidiyor ve eşitlik
      // tesadüf değil, sözleşme.
      expect(report.totals.collectedMinor).toBe(postedTotal);
      expect(report.totals.collectedMinor).toBe(85_000);
      // İptal edilen tahsilat toplamda YOK — satırı duruyor ama para kasada değil.
      expect(report.totals.collectedMinor).not.toBe(125_000);
    });

    it('tahakkuk ile tahsilat AYRI sayılar', async () => {
      await createCharge(100_000, 'Kalem');
      await pay({ amountMinor: 30_000 });

      const report = (await revenue()).body as RevenueReport;
      expect(report.totals.accruedMinor).toBe(100_000);
      expect(report.totals.collectedMinor).toBe(30_000);
    });

    it('iptal edilen KALEM tahakkuktan düşüyor', async () => {
      const chargeId = await createCharge(50_000, 'İptal edilecek');
      await createCharge(20_000, 'Kalan');

      const current = await http(app).get(`/api/v1/charges/${chargeId}`).set(ownerAuth());
      const voidRes = await http(app)
        .post(`/api/v1/charges/${chargeId}/void`)
        .set(ownerAuth())
        .set(branch())
        .set('if-match', `W/"${(current.body as { version: number }).version}"`)
        .send({ reason: 'Yanlış kalem açıldı' });
      expect(voidRes.status).toBe(200);

      const report = (await revenue()).body as RevenueReport;
      expect(report.totals.accruedMinor).toBe(20_000);
    });
  });

  describe('kırılım', () => {
    it('personelsiz kalemler kırılımda KAYBOLMUYOR', async () => {
      await createCharge(30_000, 'Elle açılan kalem');

      const report = (
        await revenue(`${range(WIDE_FROM, WIDE_TO)}&groupBy=staff`)
      ).body as RevenueReport;

      // Elle açılan kalemin personeli yok; LEFT JOIN olmasaydı satır düşer ve
      // kırılım toplamı genel toplamı tutmazdı.
      const sum = report.data.reduce((total, row) => total + row.accruedMinor, 0);
      expect(sum).toBe(report.totals.accruedMinor);
      expect(report.data[0]?.groupLabel).toBe('—');
    });

    it('ödeme yöntemi kırılımı yalnız tahsilatı sayıyor', async () => {
      await createCharge(100_000, 'Kalem');
      await pay({ amountMinor: 40_000, method: 'card' });
      await pay({ amountMinor: 10_000, method: 'bank_transfer' });

      const report = (
        await revenue(`${range(WIDE_FROM, WIDE_TO)}&groupBy=method`)
      ).body as RevenueReport;

      const byMethod = Object.fromEntries(
        report.data.map((row) => [row.groupLabel, row.collectedMinor]),
      );
      expect(byMethod.card).toBe(40_000);
      expect(byMethod.bank_transfer).toBe(10_000);
      // Yöntem bir KALEM özelliği değil; tahakkuk sütunu bilerek sıfır.
      expect(report.data.every((row) => row.accruedMinor === 0)).toBe(true);
    });
  });

  describe('yetki', () => {
    it('resepsiyon ciro raporunu GÖREMİYOR', async () => {
      const res = await http(app)
        .get(`/api/v1/reports/revenue?${range(WIDE_FROM, WIDE_TO)}`)
        .set(auth(clinic.practitioner.tokens));

      // Uygulayıcıda `report.revenue:read` yok; `report.performance:read.own`
      // ciroyu AÇMIYOR — o izin yalnız kendi performans satırını açar.
      expect(res.status).toBe(403);
    });
  });
});
