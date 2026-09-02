-- Batch 9.1 — online randevu sayfasının dizin katmanı: site, alan adı, rezerve konak adları.
--
-- ÇEKİRDEK PROBLEM: public bir istek "bu slug/konak adı hangi kiracıya ait?"
-- sorusunu KİRACI CONTEXT'İ OLUŞMADAN ÖNCE sormak zorundadır. `tenants`
-- politikası bağlamsız sorguda boş küme döndürür (0005), yani bu soru RLS
-- altında cevaplanamaz.
--
-- ÇÖZÜM: `app.public_flow` — dar, adı olan, denetlenebilir bir kapı.
--
--   * `app.auth_flow` yeniden KULLANILMADI: o bayrak `users`, `credentials`,
--     `auth_sessions`, `refresh_tokens`, `invitations`, `mfa_*`, `passkeys` ve
--     `phone_verification_codes` politikalarında geçiyor. Kimlik akışlarının
--     hepsinde parola/passkey ispatı var; randevu sayfasında HİÇBİR ispat yok.
--     Bayrağı paylaşmak, public modüldeki tek bir dikkatsiz sorgunun kimlik
--     bilgisi satırı okuyabilmesi demekti.
--   * `app.platform_admin` yeniden KULLANILMADI: `tenants_isolation` o bayrağa
--     her satırda okuma VE YAZMA veriyor.
--
-- SÖZLEŞME: `current_public_flow()` YALNIZCA bu dosyadaki iki tablonun
-- politikalarında geçebilir — `booking_sites` ve `booking_site_domains`.
-- Başka hiçbir tabloda geçemez; bunu doğrulayan bir entegrasyon testi var.
-- İki tablo da DİZİN verisidir: slug, konak adı, tenant_id, yayın durumu,
-- doğrulama durumu. Müşteri, randevu, içerik veya tema verisi taşımazlar.
-- Bayrağın en kötü sızıntısı "yayında hangi klinikler var" — DNS ve Google
-- üzerinden zaten herkese açık olan bilgi.

create or replace function current_public_flow() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('app.public_flow', true), ''), 'off') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- Rezerve konak adları
-- ---------------------------------------------------------------------------
-- 0005'te `tenants_slug_not_reserved` listeyi INLINE tutuyordu. Faz 9 aynı
-- listeye ikinci bir yerden (özel alan adı ve subdomain doğrulaması) ihtiyaç
-- duyuyor; iki inline liste er ya da geç birbirinden ayrılır ve slug olarak
-- yasak bir kelime konak adı olarak serbest kalır.
create table reserved_hostnames (
  name       citext primary key,
  reason     text not null,
  created_at timestamptz not null default now()
);

insert into reserved_hostnames (name, reason) values
  ('www',      'Kanonik web adresi'),
  ('api',      'API kökü'),
  ('admin',    'Yönetim paneli'),
  ('app',      'Uygulama kabuğu'),
  ('docs',     'Dokümantasyon'),
  ('mail',     'Posta'),
  ('static',   'Statik varlıklar'),
  ('assets',   'Statik varlıklar'),
  ('cdn',      'İçerik dağıtım ağı'),
  ('status',   'Durum sayfası'),
  ('help',     'Destek'),
  ('support',  'Destek'),
  ('blog',     'Blog'),
  ('klinara',  'Marka'),
  ('booking',  'Randevu kökü'),
  ('randevu',  'Randevu kökü'),
  ('internal', 'İç uçlar'),
  ('edge',     'Kenar proxy')
on conflict (name) do nothing;

-- 0005'teki inline check yerine referans tabloyu okuyan trigger.
--
-- `security definer`: kiracı bootstrap'ı `tenants` satırını platform_admin
-- bağlamında yazıyor ve `reserved_hostnames` okuması RLS'e takılmamalı.
-- `search_path` sabitlenir — `security definer` fonksiyonda bu ihmal
-- edilemez.
create or replace function tenants_check_slug() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists (select 1 from reserved_hostnames r where r.name = new.slug) then
    raise exception 'Bu slug rezerve edilmiştir: %', new.slug
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function tenants_check_slug() from public;

alter table tenants drop constraint tenants_slug_not_reserved;
create trigger tenants_slug_reserved_check
  before insert or update of slug on tenants
  for each row execute function tenants_check_slug();

-- ---------------------------------------------------------------------------
-- booking_sites — kiracı başına TEK randevu sayfası
-- ---------------------------------------------------------------------------
-- `tenant_id` UNIQUE: şube başına ayrı site (franchise senaryosu) bilerek
-- dışarıda bırakıldı. Sayfa içinde şube seçici var; çoklu siteye dönmek
-- sonradan pahalı değil ama önce ürün kararı gerekiyor.
create type booking_site_status as enum ('draft', 'published', 'unpublished');

create table booking_sites (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,

  -- `tenants.slug`in kopyası. Neden kopya: public çözümleme `tenants`a hiç
  -- dokunmadan cevaplanabilsin diye — `tenants` satırı ad, durum ve para
  -- birimi taşır, public bayrağın onlara erişmesi için sebep yok.
  slug citext not null unique,

  -- Tek şubeli kiracıda şube seçimi ekranı atlanır.
  default_branch_id uuid references branches(id) on delete set null,

  status booking_site_status not null default 'draft',

  -- İçerik sürümleri 0036'da gelir; FK o migration'da eklenir.
  published_revision_id uuid,
  draft_revision_id     uuid,
  published_at          timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint booking_sites_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  -- Yayınlanmış bir sitenin yayınlanmış içeriği olmak ZORUNDA. Aksi hâlde
  -- public uç boş bir sayfa dönerdi.
  constraint booking_sites_published_needs_revision check (
    status <> 'published' or published_revision_id is not null
  )
);

create index booking_sites_tenant_idx on booking_sites (tenant_id) where deleted_at is null;

-- `tenants.slug` değişince site slug'ı ve platform subdomain'i ONUNLA gider.
-- Uygulama katmanında yapılsaydı bir gün unutulur ve kliniğin kanonik adresi
-- eski slug'da asılı kalırdı.
create or replace function booking_sites_sync_slug() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update booking_sites set slug = new.slug where tenant_id = new.id;

  -- Yalnız İLK ETİKET değişir; kök alan adı (`klinara.app`, yerelde
  -- `klinara.localhost`) olduğu gibi kalır. Etiketleri parçalayıp yeniden
  -- birleştirmek kök alan adının kaç parçalı olduğuna bağımlılık yaratırdı.
  perform set_config('app.domain_sync', 'on', true);
  update booking_site_domains
     set host = new.slug || substring(host from position('.' in host))
   where tenant_id = new.id and kind = 'platform_subdomain';
  perform set_config('app.domain_sync', 'off', true);

  return new;
end $$;

revoke execute on function booking_sites_sync_slug() from public;

-- ---------------------------------------------------------------------------
-- booking_site_domains — erişilebilir HER konak adı burada bir satırdır
-- ---------------------------------------------------------------------------
-- "Fallback" diye bir çalışma zamanı dalı YOK: `{slug}.klinara.app` de,
-- `randevu.klinik.com` da aynı tablonun satırıdır, yalnız `kind`leri farklı.
create type booking_domain_kind as enum ('platform_subdomain', 'custom');
create type domain_verification_status as enum
  ('pending', 'dns_verified', 'active', 'failed', 'disabled');

create table booking_site_domains (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  booking_site_id uuid not null references booking_sites(id) on delete cascade,

  host citext not null,
  kind booking_domain_kind not null,

  verification_status domain_verification_status not null default 'pending',
  -- `_klinara-verify.<host>` TXT kaydına yazılacak değer.
  verification_token  text not null,
  -- Kliniğin CNAME hedefi. Trafiğin bize ulaşması bu kayda bağlı.
  dns_target          text not null,

  check_attempts  integer not null default 0 check (check_attempts >= 0),
  last_checked_at timestamptz,
  verified_at     timestamptz,
  -- Kenar proxy'sinin ilk sertifika isteği. `dns_verified → active` geçişi
  -- burada olur: Caddy yalnız sertifika alacakken sorar ve alma ancak trafik
  -- gerçekten bize ulaşıyorsa başarılı olur — kendi ağımızdan yapılan bir DNS
  -- sorgusundan daha güçlü kanıt.
  activated_at    timestamptz,
  failure_reason  text,

  is_primary boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Konak adı biçimi: punycode'a çevrilmiş, küçük harfli, en çok 253 karakter.
  constraint booking_site_domains_host_format check (
    length(host) between 4 and 253
    and host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
    and host like '%.%'
  ),
  -- Özel alan adı platformun kök alan adının ALTINDA OLAMAZ. Aksi hâlde bir
  -- kiracı `api.klinara.app`i "özel alan adım" diye talep edebilirdi.
  constraint booking_site_domains_custom_not_platform check (
    kind = 'platform_subdomain' or host !~ '\.klinara\.app$'
  ),
  -- `platform_subdomain` doğuştan `active`: kliniğin kanonik adresi bir
  -- doğrulama sürecine tabi değil, bize ait.
  constraint booking_site_domains_platform_active check (
    kind <> 'platform_subdomain' or verification_status = 'active'
  )
);

-- PLATFORM GENELİNDE tekil. RLS bu tekilliği GÖRÜNMEZ kılar (kiracı A,
-- kiracı B'nin satırını okuyamaz) ama unique index yine de çalışır: çakışma
-- 23505 olarak döner ve uygulama `HOST_TAKEN`a çevirir — hangi kiracının
-- aldığını SÖYLEMEDEN.
create unique index booking_site_domains_host_key on booking_site_domains (host);

-- Site başına tek birincil host (= canonicalUrl).
create unique index booking_site_domains_primary_key
  on booking_site_domains (booking_site_id) where is_primary;

create index booking_site_domains_site_idx on booking_site_domains (booking_site_id);
-- Doğrulama süpürücüsünün taradığı küme.
create index booking_site_domains_pending_idx
  on booking_site_domains (tenant_id, verification_status)
  where verification_status in ('pending', 'dns_verified');

-- Rezerve konak adı kontrolü + `platform_subdomain` satırlarının korunması.
--
-- İkisi tek trigger'da: uygulamanın `platform_subdomain` satırlarını
-- değiştirememesi bir yetki kuralı değil, bir bütünlük kuralıdır. Bir bug
-- kliniğin kanonik adresini yayından kaldıramaz.
create or replace function booking_site_domains_guard() returns trigger
language plpgsql as $$
declare
  label text;
begin
  -- `app.domain_sync`: slug senkronizasyonunun kendi trigger'ından geldiğini
  -- söyleyen tek amaçlı bayrak. `app.platform_admin`: kiracı silme gibi
  -- platform işlemleri (cascade) buradan geçer.
  if current_setting('app.domain_sync', true) = 'on'
     or current_setting('app.platform_admin', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.kind = 'platform_subdomain' then
      raise exception 'Platform subdomain satırı silinemez: %', old.host
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.kind = 'platform_subdomain'
     and (new.host is distinct from old.host or new.kind is distinct from old.kind) then
    raise exception 'Platform subdomain satırı uygulama tarafından değiştirilemez'
      using errcode = 'restrict_violation';
  end if;

  label := split_part(new.host, '.', 1);
  if new.kind = 'custom' and exists (select 1 from reserved_hostnames r where r.name = new.host) then
    raise exception 'Bu konak adı rezerve edilmiştir: %', new.host
      using errcode = 'check_violation';
  end if;
  if new.kind = 'platform_subdomain'
     and exists (select 1 from reserved_hostnames r where r.name = label) then
    raise exception 'Bu subdomain rezerve edilmiştir: %', label
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger booking_site_domains_guard_trg
  before insert or update or delete on booking_site_domains
  for each row execute function booking_site_domains_guard();

-- `booking_sites_sync_slug` `booking_site_domains`e dokunuyor; trigger'ı ancak
-- tablo doğduktan sonra bağlayabiliriz.
create trigger tenants_sync_booking_slug
  after update of slug on tenants
  for each row when (old.slug is distinct from new.slug)
  execute function booking_sites_sync_slug();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table reserved_hostnames enable row level security;
alter table reserved_hostnames force row level security;
create policy reserved_hostnames_read on reserved_hostnames for select using (true);

alter table booking_sites enable row level security;
alter table booking_sites force row level security;
create policy booking_sites_isolation on booking_sites
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- YAYIN KAPISI POLİTİKADA, SERVİSTE DEĞİL. Yayınlanmamış site public
-- çözümlemede yapısal olarak görünmez — unutulabilecek bir `if` değil.
create policy booking_sites_public_lookup on booking_sites
  for select
  using (current_public_flow() and status = 'published' and deleted_at is null);

alter table booking_site_domains enable row level security;
alter table booking_site_domains force row level security;
create policy booking_site_domains_isolation on booking_site_domains
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Public çözümleme `pending` ve `failed` konak adlarını GÖRMEZ: henüz kimsenin
-- olmayan bir alan adı üzerinden kiracı seçilemez.
--
-- `dns_verified` de görünür çünkü kenar proxy'sinin sertifika ÖNCESİ sorduğu
-- soru tam olarak "bu host bize ait mi?"dir ve o an satır henüz `active`
-- değildir. İki durumu birbirinden ayıran şey politika değil, çağıran uçtur:
-- `/public/resolve` sorgusunda `active` arar (içeriği olmayan bir konak adı
-- sayfa döndüremez), iç uç ikisini de kabul eder.
create policy booking_site_domains_public_lookup on booking_site_domains
  for select
  using (current_public_flow() and verification_status in ('active', 'dns_verified'));

-- ---------------------------------------------------------------------------
-- Trigger'lar ve yetkiler
-- ---------------------------------------------------------------------------
create trigger booking_sites_set_updated_at
  before update on booking_sites for each row execute function set_updated_at();
create trigger booking_site_domains_set_updated_at
  before update on booking_site_domains for each row execute function set_updated_at();

create trigger booking_sites_audit
  after insert or update or delete on booking_sites
  for each row execute function audit_row_change('tenant_id');
-- Alan adı sahipliği bir güvenlik olayıdır: kim ne zaman hangi konak adını
-- talep etti sorusunun cevabı denetim kaydında durmalı.
create trigger booking_site_domains_audit
  after insert or update or delete on booking_site_domains
  for each row execute function audit_row_change('tenant_id');

grant select on reserved_hostnames to klinara_app;
revoke insert, update, delete on reserved_hostnames from klinara_app;

grant select, insert, update, delete on booking_sites to klinara_app;
grant select, insert, update, delete on booking_site_domains to klinara_app;

-- ---------------------------------------------------------------------------
-- İzinler
-- ---------------------------------------------------------------------------
insert into permissions (key, description) values
  ('booking_page:read',   'Online randevu sayfası ayarlarını görüntüleme'),
  ('booking_page:manage', 'Online randevu sayfasını, içeriğini ve alan adlarını yönetme')
on conflict (key) do update
  set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',        'booking_page:read'),
  ('owner',        'booking_page:manage'),
  ('manager',      'booking_page:read'),
  ('manager',      'booking_page:manage'),
  ('receptionist', 'booking_page:read')
on conflict do nothing;
