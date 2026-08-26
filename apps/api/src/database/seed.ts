import { createHash, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { loadEnvOrExit } from '../config/load-env';

/** `Algorithm.Argon2id`. Ambient const enum olduğu için değeri doğrudan yazıyoruz. */
const ARGON2_ID = 2;

const DEMO_OWNER_EMAIL = 'sahip@demo-klinik.test';
const DEMO_PASSWORD = 'demo-parola-12345';
/**
 * Mobil giriş DOĞRULANMIŞ bir numara ister (bkz. 4.7): doğrulanmamış numara
 * kimlik değil, yalnız bir iletişim alanıdır. Numarası olmayan demo hesabıyla
 * iOS akışı telefon doğrulama adımında takılırdı; burada baştan doğrulanmış
 * geliyor. Yalnız geliştirme ortamı — bu script üretimde koşmaz.
 */
const DEMO_OWNER_PHONE = '+905321234567';

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

    // İşletme sahibi: Faz 1'den sonra giriş yapılabilir bir hesap olmadan API
    // kullanılamaz (kiracı context'i JWT'den gelir, başlıktan değil).
    const passwordHash = await hash(DEMO_PASSWORD, {
      algorithm: ARGON2_ID,
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    });

    const owner = await client.query<{ id: string }>(
      `insert into users (email, full_name, password_hash, phone, phone_verified_at)
       values ($1, 'Demo Klinik Sahibi', $2, $3, now())
       on conflict (email) where deleted_at is null
       do update set password_hash      = excluded.password_hash,
                     phone              = excluded.phone,
                     phone_verified_at  = coalesce(users.phone_verified_at, now())
       returning id`,
      [DEMO_OWNER_EMAIL, passwordHash, DEMO_OWNER_PHONE],
    );
    const ownerId = owner.rows[0]?.id;
    if (ownerId === undefined) throw new Error('Demo kullanıcı oluşturulamadı');

    await client.query(
      `insert into memberships (tenant_id, user_id, role_key)
       values ($1, $2, 'owner')
       on conflict do nothing`,
      [tenantId, ownerId],
    );

    // Resepsiyon için bekleyen bir davet: davet akışı yerelde tek komutla denenebilsin.
    const invitationToken = randomBytes(32).toString('base64url');
    const branch = await client.query<{ id: string }>(
      `select id from branches where tenant_id = $1 and slug = 'merkez'`,
      [tenantId],
    );
    await client.query(
      `insert into invitations (tenant_id, branch_id, role_key, email, full_name, token_hash, expires_at)
       values ($1, $2, 'receptionist', 'resepsiyon@demo-klinik.test', 'Demo Resepsiyon', $3, now() + interval '7 days')
       on conflict (tenant_id, email) where accepted_at is null and revoked_at is null
       do nothing`,
      [tenantId, branch.rows[0]?.id, createHash('sha256').update(invitationToken).digest('hex')],
    );

    process.stdout.write(
      `[seed] Demo kiracı hazır: ${tenantId} (slug: demo-klinik)\n` +
        `[seed] Giriş: ${DEMO_OWNER_EMAIL} / ${DEMO_PASSWORD}\n` +
        `[seed] Telefonla giriş (doğrulanmış): ${DEMO_OWNER_PHONE}\n` +
        `[seed] Bekleyen davet token'ı: ${invitationToken}\n`,
    );
  } finally {
    await client.end();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write(`[seed] BAŞARISIZ\n${String(error)}\n`);
  process.exit(1);
});
