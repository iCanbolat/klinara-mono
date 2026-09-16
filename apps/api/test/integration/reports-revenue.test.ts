import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';
import { insertCharge, voidCharge } from '../helpers/charges';

interface RevenueReport {
  scope: 'all' | 'own';
  totals: { accruedMinor: number; currency: string };
  data: { groupId: string | null; groupLabel: string; accruedMinor: number }[];
  previous?: { accruedMinor: number };
  delta?: Record<string, number | null>;
}

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

// Pencere fixture'ın tamamını kapsıyor: kalemler `now()` ile
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

  const revenue = (query = range(WIDE_FROM, WIDE_TO)) =>
    http(app).get(`/api/v1/reports/revenue?${query}`).set(ownerAuth());

  const createCharge = (amountMinor: number, description: string): Promise<string> =>
    insertCharge(database.ownerPool, clinic, amountMinor, description);

  // ---------------------------------------------------------------------------
  describe('tahakkuk', () => {
    it('açık kalemlerin toplamı', async () => {
      await createCharge(30_000, 'Kalem A');
      await createCharge(70_000, 'Kalem B');
      await createCharge(45_000, 'Kalem C');

      const report = (await revenue()).body as RevenueReport;
      expect(report.totals.accruedMinor).toBe(145_000);
      expect(report.totals.currency).toBe('TRY');
    });

    it('iptal edilen KALEM tahakkuktan düşüyor', async () => {
      const chargeId = await createCharge(50_000, 'İptal edilecek');
      await createCharge(20_000, 'Kalan');
      await voidCharge(database.ownerPool, chargeId, 'Yanlış kalem açıldı');

      const report = (await revenue()).body as RevenueReport;
      expect(report.totals.accruedMinor).toBe(20_000);
    });

    it('tahsilat alanları yanıtta YOK (0045)', async () => {
      await createCharge(10_000, 'Kalem');
      const report = (await revenue()).body as { totals: Record<string, unknown> };
      expect(Object.keys(report.totals).sort()).toEqual(['accruedMinor', 'currency']);
    });
  });

  describe('kırılım', () => {
    it('personelsiz kalemler kırılımda KAYBOLMUYOR', async () => {
      await createCharge(30_000, 'Elle açılan kalem');

      const report = (
        await revenue(`${range(WIDE_FROM, WIDE_TO)}&groupBy=staff`)
      ).body as RevenueReport;

      // Kalemin personeli yok; LEFT JOIN olmasaydı satır düşer ve kırılım
      // toplamı genel toplamı tutmazdı.
      const sum = report.data.reduce((total, row) => total + row.accruedMinor, 0);
      expect(sum).toBe(report.totals.accruedMinor);
      expect(report.data[0]?.groupLabel).toBe('—');
    });

    it('ödeme yöntemi kırılımı artık geçersiz', async () => {
      const res = await revenue(`${range(WIDE_FROM, WIDE_TO)}&groupBy=method`);
      expect(res.status).toBe(400);
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
