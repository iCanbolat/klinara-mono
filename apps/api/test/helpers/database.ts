import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../../src/database/migrate';

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
  // Docker'ı olmayan bir geliştirme makinesinde testleri koşturabilmek için
  // OPT-IN kaçış: `TEST_POSTGRES_OWNER_URL` verilirse konteyner açılmaz ve o
  // sunucuda her çağrı için yeni bir veritabanı oluşturulur.
  //
  // Varsayılan yol DEĞİŞMEDİ: CI ve normal koşum Testcontainers kullanır.
  // Değişken yalnız yereldeki bir PostgreSQL'i işaret eder; ayrı veritabanı
  // açmak, dosyaların birbirinin şemasını görmemesi için şart.
  const externalOwnerUrl = process.env['TEST_POSTGRES_OWNER_URL'];
  const external = externalOwnerUrl !== undefined && externalOwnerUrl !== '';

  let container: StartedPostgreSqlContainer | undefined;
  let ownerUrl: string;

  if (external) {
    ownerUrl = await createScratchDatabase(externalOwnerUrl);
  } else {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('klinara_test')
      .withUsername('klinara_owner')
      .withPassword('owner_test_password')
      .start();
    ownerUrl = container.getConnectionUri();
  }

  await runMigrations(ownerUrl);

  const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 5 });

  // Rolü migration (0003_app_role.sql) oluşturur; burada yalnızca test ortamına
  // özgü kimlik bilgisini veriyoruz — üretimde de parola migration'da değil,
  // ortam yönetiminde durur.
  await ownerPool.query(`alter role ${APP_ROLE} login password '${APP_PASSWORD}'`);
  if (external) {
    // Paylaşılan sunucuda rol bir kez doğar ama yeni veritabanına bağlanma
    // hakkı verilmiş olmaz.
    await ownerPool.query(
      `grant connect on database "${new URL(ownerUrl).pathname.slice(1)}" to ${APP_ROLE}`,
    );
  }

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
      // Referans veri (roller, izinler) migration tarafından yazılır ve sistem
      // sözleşmesinin parçasıdır — testler arasında SİLİNMEZ. Silinseydi her
      // testin başında rol tablosu boş olur, üyelik ve davet yazımları
      // anlamsız bir foreign key hatasıyla düşerdi.
      const { rows } = await ownerPool.query<{ tablename: string }>(
        `select tablename from pg_tables
          where schemaname = 'public'
            and tablename not in (
              '_klinara_migrations', 'roles', 'permissions', 'role_permissions',
              'appointment_status_transitions',
              -- Rezerve konak adları da referans veridir: silinirse "admin"
              -- gibi bir slug testler arasında sessizce serbest kalır ve
              -- rezerve kelime koruması hiç sınanmamış olur.
              'reserved_hostnames'
            )`,
      );
      if (rows.length === 0) return;
      const list = rows.map((r) => `public."${r.tablename}"`).join(', ');
      await ownerPool.query(`truncate ${list} restart identity cascade`);
    },
    stop: async () => {
      await appPool.end();
      await ownerPool.end();
      if (container !== undefined) await container.stop();
      else await dropScratchDatabase(externalOwnerUrl as string, ownerUrl);
    },
  };
}

/** Harici sunucuda benzersiz bir test veritabanı açar ve URL'ini döner. */
async function createScratchDatabase(baseUrl: string): Promise<string> {
  const name = `klinara_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    // `C` sıralaması BİLİNÇLİ: testler veritabanının `order by` sonucunu
    // JavaScript'in `.sort()` çıktısıyla karşılaştırıyor (bkz. izin listesi
    // drift testi) ve ikisinin aynı olmasını garanti eden tek sıralama bayt
    // sırasıdır. Yerel makinenin locale'i (macOS'ta tr_TR) noktalama
    // işaretlerini farklı sıralar ve testi kodla ilgisi olmayan bir sebeple
    // kırardı.
    await admin.query(
      `create database "${name}" template template0 lc_collate 'C' lc_ctype 'C' encoding 'UTF8'`,
    );
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function dropScratchDatabase(baseUrl: string, createdUrl: string): Promise<void> {
  const name = new URL(createdUrl).pathname.slice(1);
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await admin.end();
  }
}
