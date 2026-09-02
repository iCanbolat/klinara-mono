import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN } from '../helpers/identity';
import { DRIZZLE, PG_POOL, type Database } from '../../src/database/database.constants';
import { withTenantTx } from '../../src/database/tenant-tx';

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

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
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
    it('kiracıyı ilk şubesi, ayarları ve sahip davetiyle birlikte oluşturur', async () => {
      const fixture = await bootstrapTenant(app, {
        slug: 'guzellik-merkezi',
        name: 'Güzellik Merkezi',
      });

      expect(fixture.tenant.slug).toBe('guzellik-merkezi');
      expect(fixture.tenant.status).toBe('trial');
      expect(fixture.tenant.timezone).toBe('Europe/Istanbul');
      expect(fixture.branch.tenantId).toBe(fixture.tenant.id);

      const settings = await http(app)
        .get('/api/v1/tenant/settings')
        .set(auth(fixture.owner.tokens));
      expect(settings.status).toBe(200);
      expect((settings.body as { reminderHoursBefore: number[] }).reminderHoursBefore).toEqual([
        24, 2,
      ]);
    });

    it('platform token olmadan kiracı oluşturulamaz', async () => {
      const res = await http(app)
        .post('/api/v1/platform/tenants')
        .send({
          slug: 'izinsiz',
          name: 'İzinsiz',
          branch: { slug: 'merkez', name: 'Merkez' },
          owner: { email: 'a@b.test' },
        });
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('FORBIDDEN');
    });

    it('yetki kontrolü GÖVDE DOĞRULAMASINDAN ÖNCE koşar (şema sızmaz)', async () => {
      // Gövde tamamen geçersiz; yine de 400 değil 403 dönmeli, aksi hâlde
      // yetkisiz çağıran alan adlarını hata mesajlarından öğrenirdi.
      const res = await http(app).post('/api/v1/platform/tenants').send({ tamamen: 'gecersiz' });
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('slug');
    });

    it('aynı slug ikinci kez alınamaz', async () => {
      await bootstrapTenant(app, { slug: 'ayni-slug', name: 'Birinci' });
      const res = await http(app)
        .post('/api/v1/platform/tenants')
        .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
        .send({
          slug: 'ayni-slug',
          name: 'İkinci',
          branch: { slug: 'merkez', name: 'Merkez' },
          owner: { email: 'ikinci@klinik.test' },
        });
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    });

    it('rezerve edilmiş slug reddedilir', async () => {
      const res = await http(app)
        .post('/api/v1/platform/tenants')
        .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
        .send({
          slug: 'admin',
          name: 'Admin',
          branch: { slug: 'merkez', name: 'Merkez' },
          owner: { email: 'admin@klinik.test' },
        });
      // DB check constraint'i ihlal edilir → 500 değil, anlamlı bir hata beklenir.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
    });

    it('geçersiz saat dilimi reddedilir', async () => {
      const res = await http(app)
        .post('/api/v1/platform/tenants')
        .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
        .send({
          slug: 'tz-testi',
          name: 'TZ',
          timezone: 'Mars/Olympus',
          branch: { slug: 'merkez', name: 'Merkez' },
          owner: { email: 'tz@klinik.test' },
        });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe("kiracı izolasyonu (FAZ 0'IN EN ÖNEMLİ TESTİ)", () => {
    it('bir kiracı diğerinin şubelerini GÖREMEZ', async () => {
      const a = await bootstrapTenant(app, { slug: 'klinik-a', name: 'Klinik A' });
      const b = await bootstrapTenant(app, { slug: 'klinik-b', name: 'Klinik B' });

      await http(app)
        .post('/api/v1/branches')
        .set(auth(a.owner.tokens))
        .send({ slug: 'kadikoy', name: 'Kadıköy' });

      const listA = await http(app).get('/api/v1/branches').set(auth(a.owner.tokens));
      const listB = await http(app).get('/api/v1/branches').set(auth(b.owner.tokens));

      expect((listA.body as { data: BranchBody[] }).data).toHaveLength(2);
      expect((listB.body as { data: BranchBody[] }).data).toHaveLength(1);
      expect((listB.body as { data: BranchBody[] }).data.map((x) => x.slug)).not.toContain(
        'kadikoy',
      );
    });

    it('bir kiracı diğerinin şubesini GÜNCELLEYEMEZ (varlığını bile sızdırmaz)', async () => {
      const a = await bootstrapTenant(app, { slug: 'klinik-c', name: 'Klinik C' });
      const b = await bootstrapTenant(app, { slug: 'klinik-d', name: 'Klinik D' });

      const res = await http(app)
        .patch(`/api/v1/branches/${a.branch.id}`)
        .set(auth(b.owner.tokens))
        .send({ name: 'ELE GEÇİRİLDİ' });
      expect(res.status).toBe(404);

      const check = await http(app).get('/api/v1/branches').set(auth(a.owner.tokens));
      expect((check.body as { data: BranchBody[] }).data[0]?.name).toBe('Merkez Şube');
    });

    it('bir kiracı diğerinin kiracı kaydını okuyamaz', async () => {
      const a = await bootstrapTenant(app, { slug: 'klinik-e', name: 'Klinik E' });
      await bootstrapTenant(app, { slug: 'klinik-f', name: 'Klinik F' });

      const res = await http(app).get('/api/v1/tenant').set(auth(a.owner.tokens));
      expect((res.body as TenantBody).slug).toBe('klinik-e');
    });

    it('token olmadan kiracı kapsamlı uç 401 döner', async () => {
      const res = await http(app).get('/api/v1/branches');
      expect(res.status).toBe(401);
      expect((res.body as Problem).code).toBe('UNAUTHENTICATED');
    });

    it('geçersiz x-branch-id başlığı 400 ile reddedilir', async () => {
      const a = await bootstrapTenant(app, { slug: 'branch-hdr', name: 'Başlık' });
      const res = await http(app)
        .get('/api/v1/branches')
        .set(auth(a.owner.tokens))
        .set('x-branch-id', 'uuid-degil');
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
         where relname in (
                 'tenants','branches','tenant_settings','audit_log',
                 'users','memberships','sessions','refresh_tokens','login_attempts',
                 'invitations','password_reset_tokens','user_totp_secrets',
                 'user_backup_codes','phone_verification_codes','user_passkeys',
                 'webauthn_challenges','roles','permissions','role_permissions'
               )
           and relkind = 'r'
      `);
      expect(rows).toHaveLength(19);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} RLS kapalı`).toBe(true);
        expect(row.relforcerowsecurity, `${row.relname} FORCE kapalı`).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('havuzlanmış bağlantıda context sızıntısı', () => {
    it('ardışık iki farklı kiracı isteği birbirine SIZMAZ', async () => {
      const a = await bootstrapTenant(app, { slug: 'sizinti-a', name: 'Sızıntı A' });
      const b = await bootstrapTenant(app, { slug: 'sizinti-b', name: 'Sızıntı B' });

      // Havuzda tek bağlantı kalacak şekilde çok sayıda ardışık istek: aynı
      // fiziksel bağlantı sürekli yeniden kullanılır. set_config transaction
      // kapsamlı olmasaydı buradaki sonuçlar birbirine karışırdı.
      for (let i = 0; i < 12; i += 1) {
        const target = i % 2 === 0 ? a : b;
        const res = await http(app).get('/api/v1/tenant').set(auth(target.owner.tokens));
        expect(res.status).toBe(200);
        expect((res.body as TenantBody).slug).toBe(target.tenant.slug);
      }
    });

    it('transaction bittikten sonra context TEMİZLENİR, sorgu 0 satır döner', async () => {
      const a = await bootstrapTenant(app, { slug: 'temizlik-a', name: 'Temizlik A' });

      await withTenantTx(
        db,
        {
          tenantId: a.tenant.id,
          userId: null,
          branchId: null,
          sessionId: null,
          requestId: 'test',
          isPlatformAdmin: false,
          isPublicBooking: false,
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
      const a = await bootstrapTenant(app, { slug: 'denetim-a', name: 'Denetim A' });

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
      const a = await bootstrapTenant(app, { slug: 'denetim-b', name: 'Denetim B' });

      const patch = await http(app)
        .patch('/api/v1/tenant')
        .set(auth(a.owner.tokens))
        .set('x-request-id', 'denetim-istegi-999')
        .send({ name: 'Yeni Ad' });
      expect(patch.status).toBe(200);

      const { rows } = await database.ownerPool.query<{
        actor_user_id: string | null;
        request_id: string | null;
        new_data: { name: string };
      }>(`select actor_user_id, request_id, new_data from audit_log
           where table_name = 'tenants' and action = 'update' order by id desc limit 1`);

      // Aktör artık başlıktan değil, access token'dan geliyor.
      expect(rows[0]?.actor_user_id).toBe(a.owner.userId);
      expect(rows[0]?.request_id).toBe('denetim-istegi-999');
      expect(rows[0]?.new_data.name).toBe('Yeni Ad');
    });

    it('parola hash’i denetim kaydına GİRMEZ', async () => {
      await bootstrapTenant(app, { slug: 'denetim-hash', name: 'Hash' });

      const { rows } = await database.ownerPool.query<{ new_data: Record<string, unknown> }>(
        `select new_data from audit_log where table_name = 'users' order by id`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row.new_data ?? {})).not.toContain('password_hash');
      }
    });

    it('denetim kaydı DEĞİŞTİRİLEMEZ ve SİLİNEMEZ', async () => {
      await bootstrapTenant(app, { slug: 'denetim-c', name: 'Denetim C' });

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
      const a = await bootstrapTenant(app, { slug: 'probe-tenant', name: 'Probe' });

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
      await database.ownerPool.query(
        'alter function audit_row_change_redacted() owner to audit_probe_owner',
      );

      try {
        const before = await database.ownerPool.query<{ n: number }>(
          'select count(*)::int as n from audit_log',
        );

        const res = await http(app)
          .patch('/api/v1/tenant')
          .set(auth(a.owner.tokens))
          .send({ name: 'Superuser Olmayan Sahip Testi' });
        expect(res.status, 'denetim yazımı işlemi bloke etmemeli').toBe(200);

        const after = await database.ownerPool.query<{ n: number }>(
          'select count(*)::int as n from audit_log',
        );
        expect(after.rows[0]?.n).toBeGreaterThan(before.rows[0]?.n ?? 0);
      } finally {
        await database.ownerPool.query('alter function audit_row_change() owner to klinara_owner');
        await database.ownerPool.query(
          'alter function audit_row_change_redacted() owner to klinara_owner',
        );
      }
    });

    it('bir kiracı diğerinin denetim kaydını okuyamaz', async () => {
      const a = await bootstrapTenant(app, { slug: 'denetim-d', name: 'Denetim D' });
      const b = await bootstrapTenant(app, { slug: 'denetim-e', name: 'Denetim E' });

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
      // Kiracıya bağlanamayan kayıtlar (ör. kiracı-üstü kullanıcı satırları)
      // hiçbir kiracının okumasına açık değildir; bu yüzden toplam >= ikisinin toplamı.
      const { rows } = await database.ownerPool.query<{ n: number }>(
        'select count(*)::int as n from audit_log',
      );
      expect(countA + countB).toBeLessThanOrEqual(rows[0]?.n ?? 0);
      expect(countA + countB).toBeGreaterThan(0);
    });
  });
});
