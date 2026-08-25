import pg from 'pg';
import { loadEnvOrExit } from '../config/load-env';

/**
 * Geliştirme ortamı hazırlığı.
 *
 * Migration'lar `klinara_app` rolünü ŞİFRESİZ ve NOLOGIN oluşturur — parola
 * sürüm geçmişine girmesin diye. Bu script yerel geliştirmede o role giriş
 * hakkı verir ve örnek bir kiracı açar.
 *
 * Üretimde çalıştırılamaz.
 */
async function seed(): Promise<void> {
  const env = loadEnvOrExit();

  if (env.NODE_ENV === 'production') {
    process.stderr.write('[seed] Üretim ortamında seed çalıştırılamaz.\n');
    process.exit(1);
  }

  const migrationUrl = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL;
  const appPassword = new URL(env.DATABASE_URL).password;
  if (appPassword === '') {
    process.stderr.write('[seed] DATABASE_URL parola içermiyor.\n');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: migrationUrl,
    application_name: 'klinara-seed',
  });
  await client.connect();

  try {
    await client.query(
      `alter role klinara_app login password ${client.escapeLiteral(appPassword)}`,
    );
    process.stdout.write('[seed] klinara_app rolüne giriş hakkı verildi\n');

    const { rows } = await client.query<{ id: string }>(
      `insert into tenants (slug, name, status)
       values ('demo-klinik', 'Demo Estetik Kliniği', 'active')
       on conflict (slug) do update set name = excluded.name
       returning id`,
    );
    const tenantId = rows[0]?.id;
    if (tenantId === undefined) throw new Error('Demo kiracı oluşturulamadı');

    await client.query(
      `insert into tenant_settings (tenant_id) values ($1) on conflict (tenant_id) do nothing`,
      [tenantId],
    );
    await client.query(
      `insert into branches (tenant_id, slug, name, timezone)
       values ($1, 'merkez', 'Merkez Şube', 'Europe/Istanbul'),
              ($1, 'kadikoy', 'Kadıköy Şube', 'Europe/Istanbul')
       on conflict (tenant_id, slug) do nothing`,
      [tenantId],
    );

    process.stdout.write(`[seed] Demo kiracı hazır: ${tenantId} (slug: demo-klinik)\n`);
  } finally {
    await client.end();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write(`[seed] BAŞARISIZ\n${String(error)}\n`);
  process.exit(1);
});
