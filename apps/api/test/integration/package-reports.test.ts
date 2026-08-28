import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';
import {
  createPackageDefinition,
  sellPackage,
  type CustomerPackageFixture,
  type PackageDefinitionFixture,
} from '../helpers/packages';

interface OutstandingReport {
  totals: {
    packages: number;
    remainingSessions: number;
    outstandingMinor: number;
    currency: string;
  };
  data: { groupId: string | null; groupLabel: string; outstandingMinor: number }[];
}

interface ExpiringReport {
  data: {
    customerPackageId: string;
    expiresAt: string;
    outstandingMinor?: number;
  }[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

interface UsageReport {
  data: {
    groupLabel: string;
    purchased: number;
    consumed: number;
    refunded: number;
    expired: number;
  }[];
}

// ⚠️ Query string'de kodlanmadan gönderilen `+03:00` offset'i BOŞLUĞA dönüşür
// ve ISO doğrulaması patlar. Aralık parametreleri daima kodlanarak eklenir.
const PERIOD_FROM = '2020-01-01T00:00:00+03:00';
const PERIOD_TO = '2099-01-01T00:00:00+03:00';

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

describe('paket raporları (Batch 5.4)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let definition: PackageDefinitionFixture;
  let sold: CustomerPackageFixture;

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
    // 10 seans, 400.000 kuruş → seans başına tam 40.000, yuvarlama artığı yok.
    definition = await createPackageDefinition(app, clinic.owner.tokens, {
      slug: 'bolgesel-10',
      name: '10 Seans Bölgesel',
      totalPriceMinor: 400_000,
      validityDays: 30,
      items: [{ serviceId: clinic.quickService.id, quantity: 10 }],
    });
    sold = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
      customerId: clinic.customer.id,
      definitionId: definition.id,
    });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const itemId = () => sold.items[0]?.id ?? '';

  const adjust = (delta: number, reason: string) =>
    http(app)
      .get(`/api/v1/customer-packages/${sold.id}`)
      .set(ownerAuth())
      .then((current) =>
        http(app)
          .post(`/api/v1/customer-packages/${sold.id}/adjust`)
          .set(ownerAuth())
          .set('if-match', `W/"${(current.body as { version: number }).version}"`)
          .send({ items: [{ customerPackageItemId: itemId(), delta }], reason })
          .expect(200),
      );

  it('yükümlülüğü bilinen fixture ile birebir hesaplar', async () => {
    const full = await http(app).get('/api/v1/reports/packages/outstanding').set(ownerAuth());
    expect(full.status).toBe(200);
    expect((full.body as OutstandingReport).totals).toEqual({
      packages: 1,
      remainingSessions: 10,
      outstandingMinor: 400_000,
      currency: 'TRY',
    });

    await adjust(-4, 'dort seans kullanildi');

    const after = await http(app).get('/api/v1/reports/packages/outstanding').set(ownerAuth());
    const body = after.body as OutstandingReport;
    expect(body.totals.remainingSessions).toBe(6);
    expect(body.totals.outstandingMinor).toBe(240_000);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.groupLabel).toBe(clinic.quickService.name);
    expect(body.data[0]?.outstandingMinor).toBe(240_000);
  });

  it('tanım fiyatı satıştan sonra zamlansa da rapor ESKİ tahsisi kullanır', async () => {
    await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', `W/"${definition.version}"`)
      .send({ totalPriceMinor: 4_000_000 })
      .expect(200);

    const report = await http(app).get('/api/v1/reports/packages/outstanding').set(ownerAuth());
    expect((report.body as OutstandingReport).totals.outstandingMinor).toBe(400_000);
  });

  it('iade edilmiş ve süresi dolmuş paketler yükümlülükte yok', async () => {
    const current = await http(app)
      .get(`/api/v1/customer-packages/${sold.id}`)
      .set(ownerAuth());

    await http(app)
      .post(`/api/v1/customer-packages/${sold.id}/refund`)
      .set(ownerAuth())
      .set('if-match', `W/"${(current.body as { version: number }).version}"`)
      .send({ reason: 'musteri vazgecti' })
      .expect(200);

    const report = await http(app).get('/api/v1/reports/packages/outstanding').set(ownerAuth());
    expect((report.body as OutstandingReport).totals.outstandingMinor).toBe(0);
  });

  it('müşteri ve şube kırılımları çalışır', async () => {
    const byCustomer = await http(app)
      .get('/api/v1/reports/packages/outstanding?groupBy=customer')
      .set(ownerAuth());
    expect((byCustomer.body as OutstandingReport).data[0]?.groupId).toBe(clinic.customer.id);

    const byBranch = await http(app)
      .get('/api/v1/reports/packages/outstanding?groupBy=branch')
      .set(ownerAuth());
    expect((byBranch.body as OutstandingReport).data[0]?.groupId).toBe(clinic.branch.id);
  });

  it('süre dolumu aralığı YARI AÇIK: to sınırındaki paket listede yok', async () => {
    const expiresAt = await database.ownerPool.query<{ expires_at: Date }>(
      'select expires_at from customer_packages where id = $1',
      [sold.id],
    );
    const boundary = expiresAt.rows[0]?.expires_at;
    expect(boundary).toBeDefined();
    const exact = new Date(boundary as unknown as string).toISOString();
    const justAfter = new Date(new Date(exact).getTime() + 1).toISOString();

    const excluded = await http(app)
      .get(`/api/v1/reports/packages/expiring?${range(PERIOD_FROM, exact)}`)
      .set(ownerAuth());
    expect((excluded.body as ExpiringReport).data).toHaveLength(0);

    const included = await http(app)
      .get(`/api/v1/reports/packages/expiring?${range(PERIOD_FROM, justAfter)}`)
      .set(ownerAuth());
    expect((included.body as ExpiringReport).data).toHaveLength(1);
    expect((included.body as ExpiringReport).data[0]?.outstandingMinor).toBe(400_000);
  });

  it('ters aralık reddedilir', async () => {
    const response = await http(app)
      .get(`/api/v1/reports/packages/expiring?${range(PERIOD_TO, PERIOD_FROM)}`)
      .set(ownerAuth());
    expect(response.status).toBe(400);
  });

  it('kullanım raporu defterden okur ve ters kayıtları düşer', async () => {
    await adjust(-3, 'uc seans kullanildi');

    const report = await http(app)
      .get(`/api/v1/reports/packages/usage?${range(PERIOD_FROM, PERIOD_TO)}`)
      .set(ownerAuth());
    const body = report.body as UsageReport;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.purchased).toBe(10);
    // Manuel düzeltme `consumed` sayılmaz; tüketim yalnız randevudan gelir.
    expect(body.data[0]?.consumed).toBe(0);
  });

  it('report.revenue:read olmayan resepsiyon yükümlülüğü göremez, para alansız listeyi görür', async () => {
    const receptionist = await inviteMember(app, clinic.owner.tokens, {
      email: 'resepsiyon@demo-klinik.test',
      roleKey: 'receptionist',
      branchId: clinic.branch.id,
      fullName: 'Resepsiyon',
    });
    const receptionAuth = auth(receptionist.tokens);

    const outstanding = await http(app)
      .get('/api/v1/reports/packages/outstanding')
      .set(receptionAuth);
    expect(outstanding.status).toBe(403);

    const expiring = await http(app)
      .get(`/api/v1/reports/packages/expiring?${range(PERIOD_FROM, PERIOD_TO)}`)
      .set(receptionAuth);
    expect(expiring.status).toBe(200);
    expect((expiring.body as ExpiringReport).data).toHaveLength(1);
    expect((expiring.body as ExpiringReport).data[0]?.outstandingMinor).toBeUndefined();
  });

  it('kiracı izolasyonu: her kiracı yalnız kendi toplamını görür', async () => {
    const other = await setupClinic(app, { slug: 'ikinci-klinik' });
    const otherDefinition = await createPackageDefinition(app, other.owner.tokens, {
      slug: 'ikinci-paket',
      name: 'İkinci Klinik Paketi',
      totalPriceMinor: 1_000_000,
      items: [{ serviceId: other.quickService.id, quantity: 5 }],
    });
    await sellPackage(app, other.owner.tokens, other.branch.id, {
      customerId: other.customer.id,
      definitionId: otherDefinition.id,
    });

    const first = await http(app).get('/api/v1/reports/packages/outstanding').set(ownerAuth());
    expect((first.body as OutstandingReport).totals.outstandingMinor).toBe(400_000);

    const second = await http(app)
      .get('/api/v1/reports/packages/outstanding')
      .set(auth(other.owner.tokens));
    expect((second.body as OutstandingReport).totals.outstandingMinor).toBe(1_000_000);
  });
});
