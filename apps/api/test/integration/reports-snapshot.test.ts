import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { OccupancyService } from '../../src/modules/reporting/occupancy.service';
import { SnapshotService } from '../../src/modules/reporting/snapshot.service';
import { SnapshotWorker } from '../../src/modules/reporting/snapshot.worker';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import type { Tx } from '../../src/database/tenant-tx';

const MONDAY = '2026-09-07';

describe('rapor özetleri (Batch 10.1)', () => {
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

  const snapshots = () => app.get(SnapshotService);
  const occupancy = () => app.get(OccupancyService);
  const tx = () => app.get(TenantTxService);

  const period = {
    from: new Date('2026-09-07T00:00:00+03:00'),
    to: new Date('2026-09-14T00:00:00+03:00'),
  };
  const fullScope = {
    branchIds: null,
    staffProfileId: null,
    kind: 'all' as const,
    showMoney: true,
  };

  const book = async (startsAt: string): Promise<string> => {
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
    return (res.body as { id: string }).id;
  };

  /**
   * Servisleri kiracı bağlamında çalıştırır — kuyruk yolunun aynısı.
   *
   * Worker'ın istek bağlamı yok; bağlamı `runForTenant` kuruyor ve
   * transaction'ı servise geçiriyor. Test bu yolu taklit etmiyor, AYNISINI
   * kullanıyor.
   */
  const asTenant = <T>(tenantId: string, fn: (handle: Tx) => Promise<T>): Promise<T> =>
    tx().runForTenant(tenantId, fn);

  const asClinic = <T>(fn: (handle: Tx) => Promise<T>): Promise<T> =>
    asTenant(clinic.tenant.id, fn);

  // ---------------------------------------------------------------------------
  it('snapshot yolu ile CANLI yol AYNI sayıyı üretiyor', async () => {
    await book(`${MONDAY}T10:00:00+03:00`);
    await book(`${MONDAY}T11:00:00+03:00`);

    const [live, written] = await asClinic(async (handle) => {
      const liveRows = await occupancy().daily(fullScope, period, handle);
      const count = await snapshots().refresh(period, handle);
      return [liveRows, count] as const;
    });

    expect(written).toBeGreaterThan(0);

    const fromSnapshot = await asClinic((handle) => snapshots().readOccupancyDaily(period, handle));

    // Sayılar hem ham günlük satırlarda hem de toplandıktan sonra aynı olmalı.
    // Toplayıcı ORTAK (`OccupancyService.group`), yani eşitlik yalnız verinin
    // aynı olmasına bağlı — iki ayrı toplama yolu yok.
    expect(OccupancyService.group(fromSnapshot, 'staff')).toEqual(
      OccupancyService.group(live, 'staff'),
    );
    expect(OccupancyService.sum(OccupancyService.group(fromSnapshot, 'day'))).toEqual(
      OccupancyService.sum(OccupancyService.group(live, 'day')),
    );
  });

  it('ikinci yenileme İDEMPOTENT — satır çoğalmıyor', async () => {
    await book(`${MONDAY}T10:00:00+03:00`);

    const first = await asClinic((handle) => snapshots().refresh(period, handle));
    const second = await asClinic((handle) => snapshots().refresh(period, handle));
    expect(second).toBe(first);

    const rows = await asClinic((handle) => snapshots().readOccupancyDaily(period, handle));
    expect(rows.filter((row) => row.localDate === MONDAY)).toHaveLength(1);
  });

  it('boşalan kova SÜPÜRÜLÜYOR — bayat satır ayakta kalmıyor', async () => {
    const appointmentId = await book(`${MONDAY}T10:00:00+03:00`);
    await asClinic((handle) => snapshots().refresh(period, handle));

    const before = await asClinic((handle) => snapshots().readOccupancyDaily(period, handle));
    expect(before.find((row) => row.localDate === MONDAY)?.bookedMinutes).toBe(30);

    // Randevu iptal edilince o günün dolu dakikası düşüyor.
    const current = await http(app)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set(ownerAuth())
      .set(branch());
    const cancelled = await http(app)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .set(ownerAuth())
      .set(branch())
      .set('if-match', `W/"${(current.body as { version: number }).version}"`)
      .send({ reason: 'Müşteri vazgeçti' });
    expect(cancelled.status).toBe(200);

    await asClinic((handle) => snapshots().refresh(period, handle));

    const after = await asClinic((handle) => snapshots().readOccupancyDaily(period, handle));
    // Satır duruyor (personelin o gün müsaitliği var) ama dolu dakika sıfır.
    // "Önce sil sonra yaz" yerine damga süpürmesi kullanılmasının sebebi tam
    // olarak bu: kova boşaldığında eski değer kalmamalı.
    expect(after.find((row) => row.localDate === MONDAY)?.bookedMinutes).toBe(0);
  });

  it('süpürücü her aktif kiracı için iş yazıyor', async () => {
    // İkinci bir kiracı: süpürücü kiracı başına ayrı iş yazmalı ki birindeki
    // hata diğerini durdurmasın.
    await bootstrapTenant(app, { slug: 'ikinci-klinik' });

    const queued = await app.get(SnapshotWorker).sweep();
    expect(queued).toBeGreaterThanOrEqual(2);
  });

  it('kiracılar arası sızıntı yok — özet satırı RLS altında', async () => {
    await book(`${MONDAY}T10:00:00+03:00`);
    await asClinic((handle) => snapshots().refresh(period, handle));

    const other = await bootstrapTenant(app, { slug: 'yabanci-klinik' });
    const seen = await asTenant(other.tenant.id, (handle) =>
      snapshots().readOccupancyDaily(period, handle),
    );

    // `report_snapshots` `force row level security` taşıyor; yabancı kiracı
    // BOŞ küme görüyor, hata değil.
    expect(seen).toHaveLength(0);
  });
});
