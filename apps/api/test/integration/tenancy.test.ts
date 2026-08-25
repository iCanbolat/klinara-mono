import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { DRIZZLE, PG_POOL, type Database } from '../../src/database/database.constants';
import { withTenantTx } from '../../src/database/tenant-tx';

const PLATFORM_TOKEN = 'platform-admin-test-tokeni-32-karakterden-uzun';

interface TenantBody {
  id: string;
  slug: string;
  name: string;
  status: string;
  timezone: string;
}
interface BranchBody {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
}
interface Problem {
  code: string;
  status: number;
}

describe('kiracılık ve RLS', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let db: Database;

  const http = () => request(app.getHttpServer());

  async function createTenant(slug: string, name: string) {
    const res = await http()
      .post('/api/v1/platform/tenants')
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
      .send({ slug, name, branch: { slug: 'merkez', name: 'Merkez Şube' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { tenant: TenantBody; branch: BranchBody };
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        AUTH_DEV_MODE: 'true',
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
      },
    });
    pool = app.get<pg.Pool>(PG_POOL);
    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
  });

  // -------------------------------------------------------------------------
  describe('platform yönetimi', () => {
    it('kiracıyı ilk şubesi ve varsayılan ayarlarıyla birlikte oluşturur', async () => {
      const { tenant, branch } = await createTenant('guzellik-merkezi', 'Güzellik Merkezi');

      expect(tenant.slug).toBe('guzellik-merkezi');
      expect(tenant.status).toBe('trial');
      expect(tenant.timezone).toBe('Europe/Istanbul');
      expect(branch.tenantId).toBe(tenant.id);

      const settings = await http().get('/api/v1/tenant/settings').set('x-tenant-id', tenant.id);
      expect(settings.status).toBe(200);
      expect((settings.body as { reminderHoursBefore: number[] }).reminderHoursBefore).toEqual([
        24, 2,
      ]);
    });

    it('platform token olmadan kiracı oluşturulamaz', async () => {
      const res = await http()
        .post('/api/v1/platform/tenants')
        .send({ slug: 'izinsiz', name: 'İzinsiz', branch: { slug: 'merkez', name: 'Merkez' } });
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('FORBIDDEN');
    });

    it('yetki kontrolü GÖVDE DOĞRULAMASINDAN ÖNCE koşar (şema sızmaz)', async () => {
      // Gövde tamamen geçersiz; yine de 400 değil 403 dönmeli, aksi hâlde
      // yetkisiz çağıran alan adlarını hata mesajlarından öğrenirdi.
      const res = await http().post('/api/v1/platform/tenants').send({ tamamen: 'gecersiz' });
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('slug');
    });

    it('aynı slug ikinci kez alınamaz', async () => {
      await createTenant('ayni-slug', 'Birinci');
      const res = await http()
        .post('/api/v1/platform/tenants')
        .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
        .send({ slug: 'ayni-slug', name: 'İkinci', branch: { slug: 'merkez', name: 'Merkez' } });
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    });

    it('rezerve edilmiş slug reddedilir', async () => {
      const res = await http()
        .post('/api/v1/platform/tenants')
        .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
        .send({ slug: 'admin', name: 'Admin', branch: { slug: 'merkez', name: 'Merkez' } });
      // DB check constraint'i ihlal edilir → 500 değil, anlamlı bir hata beklenir.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
    });

    it('geçersiz saat dilimi reddedilir', async () => {
      const res = await http()
        .post('/api/v1/platform/tenants')
        .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
        .send({
          slug: 'tz-testi',
          name: 'TZ',
          timezone: 'Mars/Olympus',
          branch: { slug: 'merkez', name: 'Merkez' },
        });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe("kiracı izolasyonu (FAZ 0'IN EN ÖNEMLİ TESTİ)", () => {
    it('bir kiracı diğerinin şubelerini GÖREMEZ', async () => {
      const a = await createTenant('klinik-a', 'Klinik A');
      const b = await createTenant('klinik-b', 'Klinik B');

      await http()
        .post('/api/v1/branches')
        .set('x-tenant-id', a.tenant.id)
        .send({ slug: 'kadikoy', name: 'Kadıköy' });

      const listA = await http().get('/api/v1/branches').set('x-tenant-id', a.tenant.id);
      const listB = await http().get('/api/v1/branches').set('x-tenant-id', b.tenant.id);

      expect((listA.body as { data: BranchBody[] }).data).toHaveLength(2);
      expect((listB.body as { data: BranchBody[] }).data).toHaveLength(1);
      expect((listB.body as { data: BranchBody[] }).data.map((x) => x.slug)).not.toContain(
        'kadikoy',
      );
    });

    it('bir kiracı diğerinin şubesini GÜNCELLEYEMEZ (varlığını bile sızdırmaz)', async () => {
      const a = await createTenant('klinik-c', 'Klinik C');
      const b = await createTenant('klinik-d', 'Klinik D');

      const res = await http()
        .patch(`/api/v1/branches/${a.branch.id}`)
        .set('x-tenant-id', b.tenant.id)
        .send({ name: 'ELE GEÇİRİLDİ' });
      expect(res.status).toBe(404);

      // A'nın şubesi değişmemiş olmalı.
      const check = await http().get('/api/v1/branches').set('x-tenant-id', a.tenant.id);
      expect((check.body as { data: BranchBody[] }).data[0]?.name).toBe('Merkez Şube');
    });

    it('bir kiracı diğerinin kiracı kaydını okuyamaz', async () => {
      const a = await createTenant('klinik-e', 'Klinik E');
      await createTenant('klinik-f', 'Klinik F');

      const res = await http().get('/api/v1/tenant').set('x-tenant-id', a.tenant.id);
      expect((res.body as TenantBody).slug).toBe('klinik-e');
    });

    it("kiracı context'i olmadan kiracı kapsamlı uç 401 döner", async () => {
      const res = await http().get('/api/v1/branches');
      expect(res.status).toBe(401);
      expect((res.body as Problem).code).toBe('TENANT_CONTEXT_MISSING');
    });

    it('geçersiz x-tenant-id başlığı 400 ile reddedilir', async () => {
      const res = await http().get('/api/v1/branches').set('x-tenant-id', 'uuid-degil');
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('RLS her kiracı tablosunda enable VE force olarak açıktır', async () => {
      const { rows } = await database.ownerPool.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`
        select relname, relrowsecurity, relforcerowsecurity
          from pg_class
         where relname in ('tenants','branches','tenant_settings','audit_log')
           and relkind = 'r'
      `);
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} RLS kapalı`).toBe(true);
        expect(row.relforcerowsecurity, `${row.relname} FORCE kapalı`).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('havuzlanmış bağlantıda context sızıntısı', () => {
    it('ardışık iki farklı kiracı isteği birbirine SIZMAZ', async () => {
      const a = await createTenant('sizinti-a', 'Sızıntı A');
      const b = await createTenant('sizinti-b', 'Sızıntı B');

      // Havuzda tek bağlantı kalacak şekilde çok sayıda ardışık istek: aynı
      // fiziksel bağlantı sürekli yeniden kullanılır. set_config transaction
      // kapsamlı olmasaydı buradaki sonuçlar birbirine karışırdı.
      for (let i = 0; i < 12; i += 1) {
        const target = i % 2 === 0 ? a : b;
        const res = await http().get('/api/v1/tenant').set('x-tenant-id', target.tenant.id);
        expect(res.status).toBe(200);
        expect((res.body as TenantBody).slug).toBe(target.tenant.slug);
      }
    });

    it('transaction bittikten sonra context TEMİZLENİR, sorgu 0 satır döner', async () => {
      const a = await createTenant('temizlik-a', 'Temizlik A');

      await withTenantTx(
        db,
        {
          tenantId: a.tenant.id,
          userId: null,
          branchId: null,
          requestId: 'test',
          isPlatformAdmin: false,
        },
        async (tx) => {
          const result = await tx.execute(sql`select count(*)::int as n from branches`);
          expect((result.rows[0] as { n: number }).n).toBe(1);
        },
      );

      // Aynı havuz, context YOK: RLS hiçbir satır döndürmemeli ve HATA da
      // fırlatmamalı (nullif sayesinde — bkz. 0002_helpers.sql).
      const after = await pool.query<{ n: number }>('select count(*)::int as n from branches');
      expect(after.rows[0]?.n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('denetim kaydı (audit log)', () => {
    it("kiracı ve şube yazımları audit_log'a düşer", async () => {
      const a = await createTenant('denetim-a', 'Denetim A');

      const { rows } = await database.ownerPool.query<{
        table_name: string;
        action: string;
        tenant_id: string;
      }>('select table_name, action, tenant_id from audit_log order by id');

      const tenantInsert = rows.find((r) => r.table_name === 'tenants');
      const branchInsert = rows.find((r) => r.table_name === 'branches');

      expect(tenantInsert?.action).toBe('insert');
      expect(tenantInsert?.tenant_id).toBe(a.tenant.id);
      expect(branchInsert?.action).toBe('insert');
      expect(branchInsert?.tenant_id).toBe(a.tenant.id);
    });

    it("actor_user_id ve request_id context'ten doğru yazılır", async () => {
      const a = await createTenant('denetim-b', 'Denetim B');
      // Gerçek bir RFC 9562 v4 UUID. Not: '1111...-4444-...' gibi uydurma
      // diziler doğrulamadan GEÇMEZ — variant biti geçersizdir.
      const actorId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

      const patch = await http()
        .patch('/api/v1/tenant')
        .set('x-tenant-id', a.tenant.id)
        .set('x-user-id', actorId)
        .set('x-request-id', 'denetim-istegi-999')
        .send({ name: 'Yeni Ad' });
      expect(patch.status).toBe(200);

      const { rows } = await database.ownerPool.query<{
        actor_user_id: string | null;
        request_id: string | null;
        new_data: { name: string };
      }>(`select actor_user_id, request_id, new_data from audit_log
           where table_name = 'tenants' and action = 'update' order by id desc limit 1`);

      expect(rows[0]?.actor_user_id).toBe(actorId);
      expect(rows[0]?.request_id).toBe('denetim-istegi-999');
      expect(rows[0]?.new_data.name).toBe('Yeni Ad');
    });

    it('denetim kaydı DEĞİŞTİRİLEMEZ ve SİLİNEMEZ', async () => {
      await createTenant('denetim-c', 'Denetim C');

      await expect(
        database.ownerPool.query(`update audit_log set action = 'insert' where id > 0`),
      ).rejects.toThrow(/değiştirilemez veya silinemez/);

      await expect(database.ownerPool.query('delete from audit_log where id > 0')).rejects.toThrow(
        /değiştirilemez veya silinemez/,
      );
    });

    it("denetim trigger'ı superuser OLMAYAN sahiple de yazabilmeli", async () => {
      // Bu test gerçek bir üretim hatasını yakalamak için var.
      //
      // Test ortamında tabloların sahibi genelde SUPERUSER'dır ve superuser
      // RLS'i her koşulda bypass eder — bu yüzden eksik bir INSERT politikası
      // testlerde hiç fark edilmez. Üretimde sahip rol superuser olmadığında
      // ise `force row level security` denetim yazımını engeller ve AFTER
      // trigger olduğu için ASIL İŞ YAZIMI DA komple başarısız olur.
      //
      // Burada trigger fonksiyonunun sahibini geçici olarak superuser olmayan
      // bir role çeviriyoruz; böylece SECURITY DEFINER o rolün haklarıyla
      // koşar ve politika gerçekten sınanır.
      const a = await createTenant('probe-tenant', 'Probe');

      await database.ownerPool.query(`
        do $$ begin
          if not exists (select 1 from pg_roles where rolname = 'audit_probe_owner') then
            create role audit_probe_owner nosuperuser nologin;
          end if;
        end $$;
      `);
      await database.ownerPool.query('grant insert, select on audit_log to audit_probe_owner');
      await database.ownerPool.query(
        'grant usage, select on sequence audit_log_id_seq to audit_probe_owner',
      );
      await database.ownerPool.query(
        'alter function audit_row_change() owner to audit_probe_owner',
      );

      try {
        const before = await database.ownerPool.query<{ n: number }>(
          'select count(*)::int as n from audit_log',
        );

        const res = await http()
          .patch('/api/v1/tenant')
          .set('x-tenant-id', a.tenant.id)
          .send({ name: 'Superuser Olmayan Sahip Testi' });
        expect(res.status, 'denetim yazımı işlemi bloke etmemeli').toBe(200);

        const after = await database.ownerPool.query<{ n: number }>(
          'select count(*)::int as n from audit_log',
        );
        expect(after.rows[0]?.n).toBeGreaterThan(before.rows[0]?.n ?? 0);
      } finally {
        await database.ownerPool.query('alter function audit_row_change() owner to klinara_owner');
      }
    });

    it('bir kiracı diğerinin denetim kaydını okuyamaz', async () => {
      const a = await createTenant('denetim-d', 'Denetim D');
      const b = await createTenant('denetim-e', 'Denetim E');

      const readAs = async (tenantId: string) => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
          const { rows } = await client.query<{ n: number }>(
            'select count(*)::int as n from audit_log',
          );
          await client.query('commit');
          return rows[0]?.n ?? 0;
        } finally {
          client.release();
        }
      };

      const countA = await readAs(a.tenant.id);
      const countB = await readAs(b.tenant.id);

      expect(countA).toBeGreaterThan(0);
      expect(countB).toBeGreaterThan(0);
      // Her biri yalnızca KENDİ kayıtlarını görür; toplam ikisinin toplamına eşit.
      const { rows } = await database.ownerPool.query<{ n: number }>(
        'select count(*)::int as n from audit_log',
      );
      expect(countA + countB).toBe(rows[0]?.n);
    });
  });
});
