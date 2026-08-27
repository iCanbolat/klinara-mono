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

    // Türkiye resmî tatilleri (Batch 2.3).
    //
    // YALNIZ sabit tarihli ulusal bayramlar. Dinî bayramlar (Ramazan, Kurban)
    // hicri takvime bağlıdır ve her yıl kayar; onları uydurulmuş tarihlerle
    // seed'lemek yanlış veriyi doğru gibi göstermek olurdu — kiracı kendi
    // yılını girer. `branch_id = null` = kiracının tüm şubeleri.
    const NATIONAL_HOLIDAYS: [string, string][] = [
      ['01-01', 'Yılbaşı'],
      ['04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'],
      ['05-01', 'Emek ve Dayanışma Günü'],
      ['05-19', 'Atatürk’ü Anma, Gençlik ve Spor Bayramı'],
      ['07-15', 'Demokrasi ve Millî Birlik Günü'],
      ['08-30', 'Zafer Bayramı'],
      ['10-29', 'Cumhuriyet Bayramı'],
    ];
    const currentYear = new Date().getUTCFullYear();
    for (const year of [currentYear, currentYear + 1]) {
      for (const [monthDay, name] of NATIONAL_HOLIDAYS) {
        await client.query(
          `insert into holidays (tenant_id, branch_id, holiday_date, name, is_closed)
           values ($1, null, $2, $3, true)
           on conflict do nothing`,
          [tenantId, `${year}-${monthDay}`, name],
        );
      }
    }

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

    // --- Faz 2/3 demo verisi -------------------------------------------------
    // Amaç: `pnpm db:seed` sonrası uygunluk ve randevu uçlarının TEK komutla
    // denenebilmesi. Bunlar olmadan `/availability` boş döner ve akış hiç
    // başlamaz.
    const merkez = await client.query<{ id: string }>(
      `select id from branches where tenant_id = $1 and slug = 'merkez'`,
      [tenantId],
    );
    const merkezId = merkez.rows[0]?.id;
    if (merkezId === undefined) throw new Error('Merkez şube bulunamadı');

    const category = await client.query<{ id: string }>(
      `insert into service_categories (tenant_id, slug, name, sort_order)
       values ($1, 'epilasyon', 'Epilasyon', 0)
       on conflict (tenant_id, slug) where deleted_at is null
       do update set name = excluded.name
       returning id`,
      [tenantId],
    );
    const categoryId = category.rows[0]?.id;

    const services = await client.query<{ id: string; slug: string }>(
      `insert into services (tenant_id, category_id, slug, name, duration_minutes,
                             buffer_before_minutes, buffer_after_minutes, price_minor)
       values ($1, $2, 'tum-vucut-lazer', 'Tüm Vücut Lazer', 60, 5, 10, 150000),
              ($1, $2, 'bolgesel-lazer',  'Bölgesel Lazer',  30, 0,  0,  50000)
       on conflict (tenant_id, slug) where deleted_at is null
       do update set name = excluded.name
       returning id, slug`,
      [tenantId, categoryId],
    );

    const staff = await client.query<{ id: string }>(
      `insert into staff_profiles (tenant_id, user_id, primary_branch_id, title, specialties)
       values ($1, $2, $3, 'Lazer Uzmanı', '{lazer,cilt}')
       on conflict (tenant_id, user_id) where deleted_at is null
       do update set title = excluded.title
       returning id`,
      [tenantId, ownerId, merkezId],
    );
    const staffId = staff.rows[0]?.id;

    for (const service of services.rows) {
      await client.query(
        `insert into staff_services (tenant_id, staff_profile_id, service_id, branch_id)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, staff_profile_id, service_id, branch_id) do nothing`,
        [tenantId, staffId, service.id, merkezId],
      );
    }

    // Pazar kapalı, diğer günler 09:00–18:00 (13:00–14:00 mola).
    for (const branchRow of [merkezId]) {
      for (let day = 0; day <= 6; day += 1) {
        const closed = day === 0;
        await client.query(
          `insert into branch_hours (tenant_id, branch_id, day_of_week, is_closed,
                                     open_time, close_time, break_start_time, break_end_time)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (branch_id, day_of_week) where deleted_at is null do nothing`,
          [
            tenantId,
            branchRow,
            day,
            closed,
            closed ? null : '09:00',
            closed ? null : '18:00',
            closed ? null : '13:00',
            closed ? null : '14:00',
          ],
        );
        await client.query(
          `insert into staff_schedules (tenant_id, staff_profile_id, branch_id, day_of_week,
                                        is_off, start_time, end_time)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (staff_profile_id, branch_id, day_of_week) where deleted_at is null
           do nothing`,
          [tenantId, staffId, branchRow, day, closed, closed ? null : '09:00', closed ? null : '18:00'],
        );
      }
    }

    await client.query(
      `insert into customers (tenant_id, full_name, phone, email)
       values ($1, 'Ayşe Yılmaz', '+905321112233', 'ayse@ornek.test'),
              ($1, 'Mehmet Demir', '+905324445566', null)
       on conflict do nothing`,
      [tenantId],
    );

    process.stdout.write(
      `[seed] Demo kiracı hazır: ${tenantId} (slug: demo-klinik)\n` +
        `[seed] Merkez şube: ${merkezId}\n` +
        `[seed] Personel profili: ${staffId ?? '-'}\n` +
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
