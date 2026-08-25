import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';

export interface TestDatabase {
  /** Tablo sahibi rol — migration'lar ve fixture kurulumu için (RLS'i bypass eder). */
  ownerUrl: string;
  /** Uygulama rolü — NOBYPASSRLS. Kiracı izolasyon testleri BUNU kullanmalıdır. */
  appUrl: string;
  ownerPool: pg.Pool;
  appPool: pg.Pool;
  stop: () => Promise<void>;
  /** Tüm iş tablolarını boşaltır (şemayı ve migration kaydını korur). */
  truncateAll: () => Promise<void>;
}

const APP_ROLE = 'klinara_app';
const APP_PASSWORD = 'app_test_password';

/**
 * Testler için gerçek bir PostgreSQL 17 konteyneri ayağa kaldırır, migration'ları
 * uygular ve iki ayrı rol için bağlantı havuzu döner.
 *
 * İki rol ayrımı testin özüdür: uygulama rolü NOBYPASSRLS olduğu için kiracı
 * izolasyonunu gerçekten kanıtlayabiliriz. Sahip rolüyle koşulan bir test RLS'i
 * atlar ve hiçbir şey ispatlamaz.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('klinara_test')
    .withUsername('klinara_owner')
    .withPassword('owner_test_password')
    .start();

  const ownerUrl = container.getConnectionUri();

  await runMigrations(ownerUrl);

  const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 5 });

  // Rolü migration (0003_app_role.sql) oluşturur; burada yalnızca test ortamına
  // özgü kimlik bilgisini veriyoruz — üretimde de parola migration'da değil,
  // ortam yönetiminde durur.
  await ownerPool.query(`alter role ${APP_ROLE} login password '${APP_PASSWORD}'`);

  const appUrl = new URL(ownerUrl);
  appUrl.username = APP_ROLE;
  appUrl.password = APP_PASSWORD;

  const appPool = new pg.Pool({ connectionString: appUrl.toString(), max: 5 });

  return {
    ownerUrl,
    appUrl: appUrl.toString(),
    ownerPool,
    appPool,
    truncateAll: async () => {
      const { rows } = await ownerPool.query<{ tablename: string }>(
        `select tablename from pg_tables
          where schemaname = 'public' and tablename <> '_klinara_migrations'`,
      );
      if (rows.length === 0) return;
      const list = rows.map((r) => `public."${r.tablename}"`).join(', ');
      await ownerPool.query(`truncate ${list} restart identity cascade`);
    },
    stop: async () => {
      await appPool.end();
      await ownerPool.end();
      await container.stop();
    },
  };
}
