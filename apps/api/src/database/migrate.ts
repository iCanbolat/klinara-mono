import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Eş zamanlı deploy'ların aynı anda migrate etmesini engelleyen kilit anahtarı. */
const ADVISORY_LOCK_KEY = 4_812_007;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/**
 * Ham SQL migration'larını sırayla, her birini kendi transaction'ında uygular.
 *
 * Neden drizzle-kit'in migrator'ı değil: bu şemanın can damarı olan RLS
 * politikaları, `EXCLUDE` constraint'leri ve trigger'lar Drizzle şema DSL'iyle
 * ifade edilemiyor. Drizzle sorgu kurucusu ve tipler için kullanılır; DDL'in
 * sahibi bu elle yazılmış, sürümlenmiş SQL dosyalarıdır.
 *
 * Uygulanmış bir migration sonradan düzenlenirse checksum tutmaz ve hata verir —
 * "bende çalışıyordu" sınıfı sapmaları erken yakalar.
 */
export async function runMigrations(connectionString: string): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString, application_name: 'klinara-migrate' });
  await client.connect();

  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    await client.query(`
      create table if not exists _klinara_migrations (
        name        text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now(),
        duration_ms integer not null
      )
    `);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from _klinara_migrations',
    );
    const alreadyApplied = new Map(rows.map((r) => [r.name, r.checksum]));

    const migrations = await loadMigrations();
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const migration of migrations) {
      const previousChecksum = alreadyApplied.get(migration.name);

      if (previousChecksum !== undefined) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration "${migration.name}" uygulandıktan SONRA değiştirilmiş.\n` +
              `  beklenen checksum: ${previousChecksum}\n` +
              `  dosyadaki        : ${migration.checksum}\n` +
              'Uygulanmış migration düzenlenmez; yeni bir migration dosyası ekleyin.',
          );
        }
        result.skipped.push(migration.name);
        continue;
      }

      const startedAt = Date.now();
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into _klinara_migrations (name, checksum, duration_ms) values ($1, $2, $3)',
          [migration.name, migration.checksum, Date.now() - startedAt],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration "${migration.name}" başarısız: ${String(error)}`, {
          cause: error,
        });
      }
      result.applied.push(migration.name);
    }

    return result;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

/** Uygulanmış en son migration adı — `/readyz` bunu raporlar. */
export async function currentMigrationVersion(client: pg.Pool | pg.Client): Promise<string | null> {
  const { rows } = await client.query<{ name: string }>(
    'select name from _klinara_migrations order by name desc limit 1',
  );
  return rows[0]?.name ?? null;
}

/** CLI: `pnpm db:migrate` */
async function cli(): Promise<void> {
  const { getEnv } = await import('../config/env.js');
  const env = getEnv();
  const url = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL;

  if (env.DATABASE_MIGRATION_URL === undefined) {
    process.stderr.write(
      '[migrate] UYARI: DATABASE_MIGRATION_URL tanımlı değil, DATABASE_URL kullanılıyor.\n' +
        '          Üretimde migration ayrı bir sahip rolüyle koşmalıdır.\n',
    );
  }

  const result = await runMigrations(url);
  for (const name of result.applied) process.stdout.write(`[migrate] uygulandı: ${name}\n`);
  process.stdout.write(
    `[migrate] tamamlandı — ${result.applied.length} uygulandı, ${result.skipped.length} zaten mevcut\n`,
  );
}

// Doğrudan çalıştırıldığında CLI olarak davran (import edildiğinde değil).
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  cli().catch((error: unknown) => {
    process.stderr.write(`[migrate] BAŞARISIZ\n${String(error)}\n`);
    process.exit(1);
  });
}
