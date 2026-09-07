import pg from 'pg';
import { loadEnvOrExit } from '../config/load-env';

/**
 * GERÇEKÇİ HACİMLİ SEED — Batch 10.2.
 *
 * `seed.ts`ten AYRI bir dosyadır ve öyle kalmalıdır. `seed.ts` demo amaçlıdır,
 * saniyeler sürer ve her geliştirici her gün koşar; hacim üretimini oraya
 * karıştırmak `pnpm db:seed`i dakikalar süren bir işe çevirirdi.
 *
 * Ürettiği hacim (10.2 kabul kriterlerinin istediği ölçek):
 *   50 şube · 200 personel · 20k müşteri · 100k randevu · 500k defter satırı
 *
 * ---------------------------------------------------------------------------
 * ÜÇ TASARIM KARARI
 * ---------------------------------------------------------------------------
 *
 * 1. ÜRETİM SET-TABANLI. Her satır için bir `INSERT` atmak 100k randevuda
 *    ağ turu başına ~0.2 ms ile bile dakikalar sürer. Bunun yerine
 *    `generate_series` ile tek sorguda üretiliyor: tüm seed tek hanelı
 *    saniyelerde bitiyor ve ölçüm yapmak isteyen kişi seed'i beklemiyor.
 *
 * 2. TRIGGER'LAR TOPLU YÜKLEME BOYUNCA KAPALI (`session_replication_role`).
 *    `package_ledger_apply` satır başına iki `select … for update` + bir
 *    `update` yapıyor; 500k satırda bu tek başına dakikalarca sürer ve
 *    kilit çekişmesi üretir. Kapatmanın bedeli, roll-up'ların (paket
 *    `remaining_sessions`, kalem `remaining_sessions`) yazılmamasıdır —
 *    yükleme sonunda TEK bir `update … from (select sum(delta) …)` ile
 *    defterden yeniden türetiliyor. Yani invariant (`sum(delta) =
 *    remaining_sessions`) seed sonunda da geçerli; yalnız yolu farklı.
 *    ⚠️ Bu, EXCLUDE constraint'ini KAPATMAZ — o bir constraint, trigger
 *    değil. Çakışan bir randevu üretilirse seed patlar, sessizce geçmez.
 *
 * 3. AYRI BİR KİRACI. Hacim `yuk-testi` slug'ı altında duruyor, demo
 *    kiracıya dokunmuyor. Böylece `pnpm db:seed` ile açılan web uygulaması
 *    100k randevunun içinde kaybolmuyor ve hacim seed'i tekrar koşturulunca
 *    yalnız kendi kiracısını siliyor.
 *
 * Üretimde çalıştırılamaz.
 */

const TENANT_SLUG = 'yuk-testi';

const BRANCHES = 50;
const STAFF_PER_BRANCH = 4; // 200 personel
const SERVICES = 10;
const CUSTOMERS = 20_000;
/** Personel başına randevu. 200 × 500 = 100k. */
const APPOINTMENTS_PER_STAFF = 500;
/** Gün başına slot (09:00–17:00, 30 dakikalık ızgara). */
const SLOTS_PER_DAY = 16;
const PACKAGES = 20_000;
/** Paket başına defter satırı: 1 satın alma + 24 tüketim = 500k. */
const LEDGER_PER_PACKAGE = 25;

function log(message: string): void {
  process.stdout.write(`[seed:volume] ${message}\n`);
}

async function seedVolume(): Promise<void> {
  const env = loadEnvOrExit();

  if (env.NODE_ENV === 'production') {
    process.stderr.write('[seed:volume] Üretim ortamında çalıştırılamaz.\n');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL,
    application_name: 'klinara-seed-volume',
    // Toplu yükleme sorguları uzun sürer; uygulamanın 10 sn'lik sınırı
    // burada geçerli değil.
    statement_timeout: 0,
  });
  await client.connect();

  const startedAt = Date.now();

  try {
    log(`kiracı '${TENANT_SLUG}' sıfırlanıyor…`);
    await client.query(`delete from tenants where slug = $1`, [TENANT_SLUG]);

    await client.query('begin');
    // Bkz. karar (2). Yalnız bu transaction'ı etkiler.
    await client.query(`set local session_replication_role = replica`);

    // --- kiracı, şubeler ---------------------------------------------------
    const tenant = await client.query<{ id: string }>(
      `insert into tenants (slug, name, status) values ($1, 'Yük Testi Kliniği', 'active')
       returning id`,
      [TENANT_SLUG],
    );
    const tenantId = tenant.rows[0]?.id;
    if (tenantId === undefined) throw new Error('kiracı oluşturulamadı');
    await client.query(`insert into tenant_settings (tenant_id) values ($1)`, [tenantId]);

    await client.query(
      `insert into branches (tenant_id, slug, name, timezone)
       select $1, 'sube-' || n, 'Şube ' || n, 'Europe/Istanbul'
         from generate_series(1, $2) n`,
      [tenantId, BRANCHES],
    );
    log(`${BRANCHES} şube`);

    // --- katalog -----------------------------------------------------------
    const category = await client.query<{ id: string }>(
      `insert into service_categories (tenant_id, slug, name, sort_order)
       values ($1, 'yuk', 'Yük', 0) returning id`,
      [tenantId],
    );
    const categoryId = category.rows[0]?.id;

    // Süre 30 dk sabit: randevu ızgarası bu varsayıma dayanıyor ve tampon
    // yok. Tamponlu hizmetlerin çakışma davranışı entegrasyon testlerinin
    // işi; buradaki amaç HACİM.
    await client.query(
      `insert into services (tenant_id, category_id, slug, name, duration_minutes, price_minor)
       select $1, $2, 'hizmet-' || n, 'Hizmet ' || n, 30, 50000 + n * 1000
         from generate_series(1, $3) n`,
      [tenantId, categoryId, SERVICES],
    );

    // --- kullanıcılar ve personel ------------------------------------------
    // Parola hash'i sabit ve GEÇERSİZ: bu hesaplarla giriş yapılmayacak,
    // 200 kez argon2 koşturmak seed'i tek başına dakikalarca uzatırdı.
    await client.query(
      `insert into users (email, full_name, password_hash, is_active)
       select 'yuk-' || n || '@yuk.test', 'Personel ' || n, '$argon2id$yuk-testi-gecersiz', true
         from generate_series(1, $1) n`,
      [BRANCHES * STAFF_PER_BRANCH],
    );

    await client.query(
      // `row_number()` OFFSET içinde kullanılamaz (PostgreSQL kısıtı);
      // sıra numarası önce türetiliyor, şube ondan sonra eşleşiyor.
      `with ranked as (
         select u.id, row_number() over (order by length(u.email), u.email) - 1 as n
           from users u where u.email like 'yuk-%@yuk.test'
       ),
       numbered_branches as (
         select id, row_number() over (order by length(slug), slug) - 1 as n
           from branches where tenant_id = $1
       )
       insert into memberships (tenant_id, user_id, role_key, branch_id)
       select $1, r.id, 'practitioner', b.id
         from ranked r
         join numbered_branches b on b.n = (r.n / $2)::int`,
      [tenantId, STAFF_PER_BRANCH],
    );

    await client.query(
      `insert into staff_profiles (tenant_id, user_id, primary_branch_id, title)
       select $1, m.user_id, m.branch_id, 'Uygulayıcı'
         from memberships m
        where m.tenant_id = $1 and m.role_key = 'practitioner'`,
      [tenantId],
    );

    // Her personel her hizmeti yapabiliyor: uygunluk motorunun aday kümesi
    // en geniş hâliyle sınansın (en pahalı hâli budur).
    await client.query(
      `insert into staff_services (tenant_id, staff_profile_id, service_id, branch_id)
       select $1, sp.id, s.id, sp.primary_branch_id
         from staff_profiles sp
        cross join services s
        where sp.tenant_id = $1 and s.tenant_id = $1`,
      [tenantId],
    );
    log(`${BRANCHES * STAFF_PER_BRANCH} personel · ${SERVICES} hizmet`);

    // --- çalışma saatleri --------------------------------------------------
    await client.query(
      `insert into branch_hours (tenant_id, branch_id, day_of_week, is_closed, open_time, close_time)
       select $1, b.id, d, d = 0,
              case when d = 0 then null else time '09:00' end,
              case when d = 0 then null else time '19:00' end
         from branches b cross join generate_series(0, 6) d
        where b.tenant_id = $1`,
      [tenantId],
    );
    await client.query(
      `insert into staff_schedules (tenant_id, staff_profile_id, branch_id, day_of_week,
                                    is_off, start_time, end_time)
       select $1, sp.id, sp.primary_branch_id, d, d = 0,
              case when d = 0 then null else time '09:00' end,
              case when d = 0 then null else time '19:00' end
         from staff_profiles sp cross join generate_series(0, 6) d
        where sp.tenant_id = $1`,
      [tenantId],
    );

    // --- müşteriler --------------------------------------------------------
    // Telefon kiracı içinde tekil: seri numarasından E.164 üretiliyor.
    await client.query(
      `insert into customers (tenant_id, full_name, phone, email)
       select $1, 'Müşteri ' || n, '+9055' || lpad(n::text, 8, '0'),
              'musteri-' || n || '@yuk.test'
         from generate_series(1, $2) n`,
      [tenantId, CUSTOMERS],
    );
    log(`${CUSTOMERS} müşteri`);

    // --- randevular --------------------------------------------------------
    // ÇAKIŞMAMA GARANTİSİ: her personel kendi ızgarasında ilerliyor.
    //   gün  = i / SLOTS_PER_DAY,  slot = i % SLOTS_PER_DAY
    //   başlangıç = bugün - 30 gün + gün + (09:00 + slot * 30dk)
    // Aynı personelde iki randevu asla aynı (gün, slot) çiftine düşmez,
    // dolayısıyla EXCLUDE constraint'i tetiklenmez. Tetiklenirse seed
    // patlar — ve patlaması doğrudur, sessiz veri bozulmasından iyidir.
    await client.query(
      // Üretilen küme önce geçici bir tabloya yazılıyor. Sebebi: randevunun
      // PERSONELİ `appointments` tablosunda bir kolon değil, kalem
      // satırındadır — `RETURNING` ile geri alınamaz. Personeli sonradan
      // "şubenin ilk personeli" diye türetmek, aynı şubedeki dört personelin
      // randevularını tek personele yığar ve EXCLUDE constraint'ini
      // tetikler. Kimlik burada üretilip üç tabloya da aynı kümeden
      // dağıtılıyor.
      `create temporary table seed_appointments on commit drop as
       select gen_random_uuid() as id,
              sp.staff_id,
              sp.branch_id,
              c.id as customer_id,
              st.status,
              t.ts as starts_at,
              t.ts + interval '30 minutes' as ends_at
         from (
           select sp.id as staff_id, sp.primary_branch_id as branch_id,
                  row_number() over (order by sp.id) - 1 as staff_index
             from staff_profiles sp where sp.tenant_id = $1
         ) sp
        cross join generate_series(0, $2 - 1) i
        cross join lateral (
          select (date_trunc('day', now() at time zone 'Europe/Istanbul')
                  - interval '30 days'
                  + (i / $3) * interval '1 day'
                  + interval '9 hours'
                  + (i % $3) * interval '30 minutes'
                 ) at time zone 'Europe/Istanbul' as ts
        ) t
        cross join lateral (
          select (array['scheduled','confirmed','completed','completed','no_show','cancelled'])
                   [1 + (i % 6)]::appointment_status as status
        ) st
        cross join lateral (
          -- Müşteri indeksi ZAMANDAN bağımsız olmak zorunda:
          -- customer_bookings_no_overlap bir müşterinin iki randevusunun
          -- çakışmasını yasaklıyor ve slot yalnız i'ye bağlı. İndeks
          -- (staff_index + i * 200) ile seçilirse aynı i'deki iki personel
          -- asla aynı müşteriye düşmez; aynı müşteri ancak aynı personelde
          -- ve 100 slot arayla tekrar eder — yani farklı günde.
          select id from customers
           where tenant_id = $1
           offset ((sp.staff_index + i * 200) % $4) limit 1
        ) c`,
      [tenantId, APPOINTMENTS_PER_STAFF, SLOTS_PER_DAY, CUSTOMERS],
    );

    await client.query(
      // `appointments_cancel_fields`: `status = 'cancelled'` ile
      // `cancelled_at is not null` birbirine DENK olmak zorunda.
      `insert into appointments (id, tenant_id, branch_id, customer_id, status,
                                 starts_at, ends_at, origin, cancelled_at)
       select id, $1, branch_id, customer_id, status, starts_at, ends_at, 'internal',
              case when status = 'cancelled' then starts_at - interval '1 day' end
         from seed_appointments`,
      [tenantId],
    );
    log(`${BRANCHES * STAFF_PER_BRANCH * APPOINTMENTS_PER_STAFF} randevu`);

    // Randevu kalemleri: personel ÜRETİLDİĞİ kümeden geliyor, şubeden
    // türetilmiyor — çakışmama garantisi buna dayanıyor.
    await client.query(
      `insert into appointment_services (tenant_id, appointment_id, service_id, staff_profile_id,
                                         sort_order, starts_at, ends_at, duration_minutes,
                                         price_minor)
       select $1, a.id, s.id, a.staff_id, 0, a.starts_at, a.ends_at, 30, s.price_minor
         from seed_appointments a
         join lateral (
           select id, price_minor from services
            where tenant_id = $1
            order by slug
            offset (('x' || substr(md5(a.id::text), 1, 8))::bit(32)::bigint % $2)
            limit 1
         ) s on true`,
      [tenantId, SERVICES],
    );

    // Zaman işgali. Tampon yok, dolayısıyla aralık randevunun kendisiyle
    // aynı. İptal/gelmedi olanlar `active = false` — trigger kapalı olduğu
    // için bu değer BURADA yazılıyor, sonradan senkronlanmıyor.
    await client.query(
      `insert into resource_bookings (tenant_id, branch_id, resource_type, resource_id,
                                      source_type, appointment_id, time_range, active)
       select $1, a.branch_id, 'staff', a.staff_id, 'appointment', a.id,
              tstzrange(a.starts_at, a.ends_at, '[)'),
              a.status not in ('cancelled', 'no_show')
         from seed_appointments a`,
      [tenantId],
    );

    await client.query(
      `insert into customer_bookings (tenant_id, customer_id, appointment_id, time_range, active)
       select $1, a.customer_id, a.id, tstzrange(a.starts_at, a.ends_at, '[)'),
              a.status not in ('cancelled', 'no_show')
         from seed_appointments a`,
      [tenantId],
    );

    // --- paketler ve defter ------------------------------------------------
    const definition = await client.query<{ id: string }>(
      `insert into package_definitions (tenant_id, slug, name, total_price_minor,
                                        is_transferable, validity_days)
       values ($1, 'yuk-paket', 'Yük Paketi', 1000000, true, 365) returning id`,
      [tenantId],
    );
    const definitionId = definition.rows[0]?.id;

    await client.query(
      `insert into customer_packages (tenant_id, customer_id, branch_id, definition_id,
                                      definition_name, definition_revision, total_price_minor,
                                      is_transferable, validity_days, sold_at, expires_at, status)
       select $1, c.id, b.id, $2, 'Yük Paketi', 1, 1000000, true, 365,
              now() - interval '60 days', now() + interval '305 days', 'active'
         from (
           select id, row_number() over (order by phone) - 1 as n
             from customers where tenant_id = $1 limit $3
         ) c
         join lateral (
           select id from branches where tenant_id = $1
            order by slug offset (c.n % $4) limit 1
         ) b on true`,
      [tenantId, definitionId, PACKAGES, BRANCHES],
    );

    await client.query(
      `insert into customer_package_items (tenant_id, customer_package_id, service_id,
                                           service_name, quantity_total, remaining_sessions,
                                           unit_list_price_minor, item_total_minor, sort_order)
       select $1, cp.id, s.id, s.name, 30, 0, 50000, 1000000, 0
         from customer_packages cp
         join lateral (
           select id, name from services where tenant_id = $1 order by slug limit 1
         ) s on true
        where cp.tenant_id = $1`,
      [tenantId],
    );

    // 1 satın alma (+30) + 24 tüketim (-1) = kalan 6.
    // `package_ledger_delta_sign` işaret kuralını zorluyor; üretim buna uyar.
    await client.query(
      `insert into package_ledger_entries (tenant_id, customer_package_id,
                                           customer_package_item_id, entry_type, delta, created_at)
       select $1, i.customer_package_id, i.id,
              case when k = 0 then 'purchase' else 'consume' end::ledger_entry_type,
              case when k = 0 then 30 else -1 end,
              now() - interval '60 days' + k * interval '1 day'
         from customer_package_items i
        cross join generate_series(0, $2 - 1) k
        where i.tenant_id = $1`,
      [tenantId, LEDGER_PER_PACKAGE],
    );
    log(`${PACKAGES} paket · ${PACKAGES * LEDGER_PER_PACKAGE} defter satırı`);

    // --- roll-up'ları defterden yeniden türet ------------------------------
    // Trigger kapalı olduğu için `remaining_sessions` yazılmadı. Invariant
    // `sum(delta) = remaining_sessions`; tek sorguda yeniden kuruluyor.
    await client.query(
      `update customer_package_items i
          set remaining_sessions = l.total
         from (select customer_package_item_id, sum(delta)::int as total
                 from package_ledger_entries where tenant_id = $1
                group by customer_package_item_id) l
        where i.id = l.customer_package_item_id and i.tenant_id = $1`,
      [tenantId],
    );
    await client.query(
      `update customer_packages cp
          set remaining_sessions = i.total
         from (select customer_package_id, sum(remaining_sessions)::int as total
                 from customer_package_items where tenant_id = $1
                group by customer_package_id) i
        where cp.id = i.customer_package_id and cp.tenant_id = $1`,
      [tenantId],
    );

    await client.query('commit');

    // --- planlayıcı istatistikleri ----------------------------------------
    // ANALYZE olmadan planlayıcı yeni tabloları boş sanır ve seq scan seçer;
    // ölçüm o hâliyle yapılırsa index'lerin işe yaramadığı sanılır. Ölçümden
    // önceki en kritik adım budur.
    log('analyze…');
    await client.query('analyze');

    // --- invariant doğrulaması ---------------------------------------------
    // Trigger'ları kapatmanın bedeli, roll-up'ların doğruluğunu ARTIK
    // trigger'ın garanti etmemesidir. Seed kendi çıktısını doğrulamadan
    // bitmiyor: bozuk bir hacim üzerinde yapılan ölçüm, ölçüm değildir.
    const drift = await client.query<{ count: string }>(
      `select count(*)::text as count
         from customer_package_items i
         join (select customer_package_item_id, sum(delta)::int as total
                 from package_ledger_entries where tenant_id = $1
                group by customer_package_item_id) l
           on l.customer_package_item_id = i.id
        where i.tenant_id = $1 and i.remaining_sessions <> l.total`,
      [tenantId],
    );
    if (drift.rows[0]?.count !== '0') {
      throw new Error(`defter ile kalan hak uyuşmuyor: ${drift.rows[0]?.count ?? '?'} kalem`);
    }

    const counts = await client.query<{ table_name: string; n: string }>(
      `select 'appointments' as table_name, count(*)::text as n from appointments where tenant_id = $1
       union all select 'resource_bookings', count(*)::text from resource_bookings where tenant_id = $1
       union all select 'package_ledger_entries', count(*)::text from package_ledger_entries where tenant_id = $1`,
      [tenantId],
    );
    for (const row of counts.rows) log(`${row.table_name}: ${row.n}`);

    log(`bitti — ${((Date.now() - startedAt) / 1000).toFixed(1)} sn`);
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

seedVolume().catch((error: unknown) => {
  process.stderr.write(`[seed:volume] ${String(error)}\n`);
  process.exit(1);
});
