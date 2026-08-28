import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import {
  createPackageDefinition,
  sellPackage,
  type CustomerPackageFixture,
  type PackageDefinitionFixture,
} from '../helpers/packages';
import { allocateMinor } from '../../src/common/money';

interface LedgerEntry {
  id: string;
  entryType: string;
  delta: number;
  customerPackageItemId: string;
  reversesEntryId: string | null;
}

describe('paket satışı ve defter (Batch 5.2)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let definition: PackageDefinitionFixture;

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
    // 10 × 150000 + 2 × 50000 = liste 1.600.000; kampanyalı satış 1.200.000.
    definition = await createPackageDefinition(app, clinic.owner.tokens, {
      slug: 'lazer-10-bakim-2',
      name: '10 Lazer + 2 Bakım',
      totalPriceMinor: 1_200_000,
      validityDays: 365,
      items: [
        { serviceId: clinic.service.id, quantity: 10 },
        { serviceId: clinic.quickService.id, quantity: 2 },
      ],
    });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const sell = () =>
    sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
      customerId: clinic.customer.id,
      definitionId: definition.id,
    });

  /**
   * Doğrulama sorguları OWNER havuzundan koşar: `klinara_app` NOBYPASSRLS ve
   * test bağlantısında kiracı context'i yok — her select boş küme dönerdi
   * (Ek G, hata #3).
   */
  const ledgerSum = async (itemId: string): Promise<number> => {
    const result = await database.ownerPool.query<{ sum: string | null }>(
      'select sum(delta)::text as sum from package_ledger_entries where customer_package_item_id = $1',
      [itemId],
    );
    return Number(result.rows[0]?.sum ?? 0);
  };

  const remainingOf = async (itemId: string): Promise<number> => {
    const result = await database.ownerPool.query<{ remaining_sessions: number }>(
      'select remaining_sessions from customer_package_items where id = $1',
      [itemId],
    );
    return Number(result.rows[0]?.remaining_sessions);
  };

  it('satış snapshot alır, tahsis kuruşu kaçırmaz ve bakiyeyi defter doldurur', async () => {
    const sold = await sell();

    expect(sold.totalPriceMinor).toBe(1_200_000);
    expect(sold.remainingSessions).toBe(12);
    expect(sold.items).toHaveLength(2);

    // Tahsis: (10×150000)=1.500.000 ve (2×50000)=100.000 ağırlıklarıyla.
    const allocation = allocateMinor(1_200_000, [1_500_000, 100_000]);
    expect(sold.items.map((item) => item.itemTotalMinor)).toEqual(allocation);
    expect(sold.items.reduce((sum, item) => sum + item.itemTotalMinor, 0)).toBe(1_200_000);

    // Bakiye satışta bile defterden geliyor.
    for (const item of sold.items) {
      expect(await ledgerSum(item.id)).toBe(item.remainingSessions);
    }

    const ledger = await http(app)
      .get(`/api/v1/customer-packages/${sold.id}/ledger`)
      .set(ownerAuth());
    const entries = (ledger.body as { data: LedgerEntry[] }).data;
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.entryType === 'purchase')).toBe(true);
    expect(entries.map((entry) => entry.delta).sort((a, b) => a - b)).toEqual([2, 10]);
  });

  it('tanım fiyatı satıştan sonra değişince satılmış paket kıpırdamaz', async () => {
    const sold = await sell();

    await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .send({ totalPriceMinor: 9_999_999 })
      .expect(200);

    const after = await http(app).get(`/api/v1/customer-packages/${sold.id}`).set(ownerAuth());
    const body = after.body as CustomerPackageFixture;
    expect(body.totalPriceMinor).toBe(1_200_000);
    expect(body.items.map((item) => item.itemTotalMinor)).toEqual(
      sold.items.map((item) => item.itemTotalMinor),
    );
  });

  it('satılmış paket tanımı silinemez, yalnız pasife alınır', async () => {
    await sell();

    await http(app)
      .delete(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .expect(204);

    const still = await http(app)
      .get(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth());
    expect(still.status).toBe(200);
    expect((still.body as { isActive: boolean }).isActive).toBe(false);
  });

  it('defter satırı UPDATE ya da DELETE edilemez', async () => {
    const sold = await sell();
    const entryId = (
      await database.ownerPool.query<{ id: string }>(
        'select id from package_ledger_entries where customer_package_id = $1 limit 1',
        [sold.id],
      )
    ).rows[0]?.id;

    // Uygulama rolüyle: hem GRANT yok hem reject_mutation() trigger'ı var.
    const client = await database.appPool.connect();
    try {
      let updateError = 'none';
      try {
        await client.query('update package_ledger_entries set delta = 99 where id = $1', [entryId]);
      } catch (error) {
        updateError = (error as { code?: string }).code ?? 'unknown';
      }
      expect(['42501', '2F004']).toContain(updateError);
    } finally {
      client.release();
    }
  });

  it('çok kalemli pakette bir kalemin tüketimi diğerini etkilemez', async () => {
    const sold = await sell();
    const laser = sold.items.find((item) => item.serviceId === clinic.service.id);
    const care = sold.items.find((item) => item.serviceId === clinic.quickService.id);
    expect(laser).toBeDefined();
    expect(care).toBeDefined();

    await database.ownerPool.query(
      `insert into package_ledger_entries
         (tenant_id, customer_package_id, customer_package_item_id, entry_type, delta)
       values ((select tenant_id from customer_packages where id = $1), $1, $2, 'consume', -1)`,
      [sold.id, laser?.id],
    );

    expect(await remainingOf(laser?.id ?? '')).toBe(9);
    expect(await remainingOf(care?.id ?? '')).toBe(2);
    expect(await ledgerSum(laser?.id ?? '')).toBe(9);
  });

  it('kalan hak 6 iken 10 eş zamanlı tüketimden tam 6sı başarılı olur', async () => {
    const sold = await sell();
    const care = sold.items.find((item) => item.serviceId === clinic.quickService.id);
    const laser = sold.items.find((item) => item.serviceId === clinic.service.id);
    expect(laser).toBeDefined();
    expect(care).toBeDefined();

    // 10 seansı 6ya indir (4 tüketim), sonra 10 paralel deneme yap.
    for (let i = 0; i < 4; i += 1) {
      await database.ownerPool.query(
        `insert into package_ledger_entries
           (tenant_id, customer_package_id, customer_package_item_id, entry_type, delta)
         values ((select tenant_id from customer_packages where id = $1), $1, $2, 'consume', -1)`,
        [sold.id, laser?.id],
      );
    }
    expect(await remainingOf(laser?.id ?? '')).toBe(6);

    const attempts = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const client = await database.ownerPool.connect();
        try {
          await client.query(
            `insert into package_ledger_entries
               (tenant_id, customer_package_id, customer_package_item_id, entry_type, delta)
             values ((select tenant_id from customer_packages where id = $1), $1, $2, 'consume', -1)`,
            [sold.id, laser?.id],
          );
          return 'ok';
        } catch (error) {
          return (error as { code?: string }).code ?? 'unknown';
        } finally {
          client.release();
        }
      }),
    );

    expect(attempts.filter((result) => result === 'ok')).toHaveLength(6);
    expect(attempts.filter((result) => result === 'K0004')).toHaveLength(4);
    expect(await remainingOf(laser?.id ?? '')).toBe(0);
    expect(await ledgerSum(laser?.id ?? '')).toBe(0);
    // Bakım kalemi hiç etkilenmedi.
    expect(await remainingOf(care?.id ?? '')).toBe(2);
  });

  it('rastgele işlem dizisinden sonra sum(delta) = remaining_sessions', async () => {
    const sold = await sell();
    const laser = sold.items.find((item) => item.serviceId === clinic.service.id);
    const sequence = [-1, -1, +1, -1, -1, -1, +2, -1, -1, -1];

    for (const delta of sequence) {
      await database.ownerPool.query(
        `insert into package_ledger_entries
           (tenant_id, customer_package_id, customer_package_item_id, entry_type, delta, reason)
         values ((select tenant_id from customer_packages where id = $1), $1, $2,
                 (case when $3::int < 0 then 'consume' else 'manual_adjustment' end)::ledger_entry_type,
                 $3::int, 'test duzeltmesi')`,
        [sold.id, laser?.id, delta],
      );
    }

    expect(await ledgerSum(laser?.id ?? '')).toBe(await remainingOf(laser?.id ?? ''));

    const rollup = await database.ownerPool.query<{ package: number; items: string }>(
      `select p.remaining_sessions as package,
              (select sum(i.remaining_sessions)::text
                 from customer_package_items i where i.customer_package_id = p.id) as items
         from customer_packages p where p.id = $1`,
      [sold.id],
    );
    expect(Number(rollup.rows[0]?.package)).toBe(Number(rollup.rows[0]?.items));
  });

  it('tahsis toplamı tutmayan paket yazılamaz (K0008)', async () => {
    const sold = await sell();
    let code = 'none';
    try {
      await database.ownerPool.query(
        `update customer_packages set total_price_minor = total_price_minor + 1 where id = $1`,
        [sold.id],
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? 'unknown';
    }
    expect(code).toBe('K0008');
  });

  it('müşteri birleştirmesinde paketler hayatta kalan karta taşınır', async () => {
    const sold = await sell();

    const duplicate = await http(app)
      .post('/api/v1/customers')
      .set(ownerAuth())
      .send({ fullName: 'Mükerrer Müşteri' })
      .expect(201);
    const duplicateId = (duplicate.body as { id: string }).id;

    const duplicatePackage = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
      customerId: duplicateId,
      definitionId: definition.id,
    });

    await http(app)
      .post(`/api/v1/customers/${clinic.customer.id}/merge`)
      .set(ownerAuth())
      .send({ sourceCustomerId: duplicateId })
      .expect(200);

    const packages = await http(app)
      .get(`/api/v1/customers/${clinic.customer.id}/packages`)
      .set(ownerAuth());
    const ids = (packages.body as { data: { id: string }[] }).data.map((row) => row.id);
    expect(ids).toContain(sold.id);
    expect(ids).toContain(duplicatePackage.id);
  });

  it('başka kiracının paketi görünmez', async () => {
    const sold = await sell();
    const other = await setupClinic(app, { slug: 'ikinci-klinik' });

    const response = await http(app)
      .get(`/api/v1/customer-packages/${sold.id}`)
      .set(auth(other.owner.tokens));
    expect(response.status).toBe(404);
  });

  it('pasif tanım satılamaz ve şube kısıtı zorlanır', async () => {
    await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .send({ isActive: false })
      .expect(200);

    const response = await http(app)
      .post('/api/v1/customer-packages')
      .set(ownerAuth())
      .set(branchHeader(clinic.branch.id))
      .send({ customerId: clinic.customer.id, definitionId: definition.id });
    expect(response.status).toBe(422);
  });

  it('aynı Idempotency-Key ile iki satış isteği tek paket üretir', async () => {
    const send = () =>
      http(app)
        .post('/api/v1/customer-packages')
        .set(ownerAuth())
        .set(branchHeader(clinic.branch.id))
        .set('idempotency-key', 'satis-1')
        .send({ customerId: clinic.customer.id, definitionId: definition.id });

    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);

    const packages = await http(app)
      .get(`/api/v1/customers/${clinic.customer.id}/packages`)
      .set(ownerAuth());
    expect((packages.body as { data: unknown[] }).data).toHaveLength(1);
  });
});
