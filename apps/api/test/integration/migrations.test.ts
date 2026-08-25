import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { runMigrations } from '../../src/database/migrate';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { createTestApp } from '../helpers/app';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src/database/migrations');
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('migration hattı', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  });

  afterAll(async () => {
    await database.stop();
  });

  it('boş veritabanında baştan sona koşar (harness zaten uyguladı)', async () => {
    const { rows } = await database.ownerPool.query<{ name: string }>(
      'select name from _klinara_migrations order by name',
    );
    // Sabit liste yerine diskteki dosyalarla karşılaştır: yeni migration
    // eklendiğinde bu test kendiliğinden güncel kalır.
    expect(rows.map((r) => r.name)).toEqual(MIGRATION_FILES);
    expect(MIGRATION_FILES.length).toBeGreaterThanOrEqual(5);
  });

  it('ikinci koşuş idempotenttir — hiçbir şey yeniden uygulanmaz', async () => {
    const result = await runMigrations(database.ownerUrl);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('gerekli uzantıları kurar', async () => {
    const { rows } = await database.ownerPool.query<{ extname: string }>(
      `select extname from pg_extension where extname in ('btree_gist','pgcrypto','citext','pg_trgm')`,
    );
    expect(rows.map((r) => r.extname).sort()).toEqual([
      'btree_gist',
      'citext',
      'pg_trgm',
      'pgcrypto',
    ]);
  });

  it('yardımcı fonksiyonlar oluşturulur', async () => {
    const { rows } = await database.ownerPool.query<{ proname: string }>(
      `select proname from pg_proc
        where proname in ('current_tenant_id','current_actor_id','reject_mutation','set_updated_at')`,
    );
    expect(rows.map((r) => r.proname).sort()).toEqual([
      'current_actor_id',
      'current_tenant_id',
      'reject_mutation',
      'set_updated_at',
    ]);
  });

  it('current_tenant_id context yokken hata fırlatmadan NULL döner', async () => {
    // Bu, 4.1'deki nullif kararının regresyon testidir. Doğrudan
    // current_setting(...)::uuid kullanılsaydı burası patlardı.
    const { rows } = await database.ownerPool.query<{ tenant: string | null }>(
      'select current_tenant_id() as tenant',
    );
    expect(rows[0]?.tenant).toBeNull();
  });

  it('uygulanmış bir migration sonradan değiştirilirse reddedilir', async () => {
    await database.ownerPool.query(
      `update _klinara_migrations set checksum = 'kurcalanmis' where name = '0001_extensions.sql'`,
    );
    await expect(runMigrations(database.ownerUrl)).rejects.toThrow(/uygulandıktan SONRA/);
    // Testi izole bırak: checksum'ı geri al.
    const { rows } = await database.ownerPool.query<{ name: string }>(
      `select name from _klinara_migrations where name = '0001_extensions.sql'`,
    );
    expect(rows).toHaveLength(1);
    await database.ownerPool.query(`delete from _klinara_migrations where name = $1`, [
      '0001_extensions.sql',
    ]);
    await runMigrations(database.ownerUrl);
  });

  it('uygulama rolü RLS bypass edemez (NOBYPASSRLS)', async () => {
    const { rows } = await database.appPool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
    );
    expect(rows[0]?.rolbypassrls).toBe(false);
    expect(rows[0]?.rolsuper).toBe(false);
  });
});

describe('GET /readyz', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({ env: { DATABASE_URL: database.appUrl } });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  it('DB ayaktayken 200 ve migration sürümünü döner', async () => {
    const res = await request(app.getHttpServer()).get('/readyz');
    expect(res.status).toBe(200);
    const body = res.body as {
      status: string;
      checks: { database: string };
      migrationVersion: string;
    };
    expect(body.status).toBe('ready');
    expect(body.checks.database).toBe('up');
    expect(body.migrationVersion).toBe(MIGRATION_FILES.at(-1));
  });
});
