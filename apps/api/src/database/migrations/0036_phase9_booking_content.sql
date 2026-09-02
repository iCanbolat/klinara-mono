-- Batch 9.2 — randevu sayfasının içeriği, teması, davranış ayarları ve görselleri.
--
-- KARAR: içerik DEĞİŞMEZ JSONB SÜRÜMLERİDİR, tipli bir blok tablosu değil.
--
-- Tipli `booking_page_sections(id, type, sort_order, …)` tablosu reddedildi:
--   * Blok sözlüğü Faz 11'de büyüyecek (referans, SSS, personel ızgarası,
--     öncesi/sonrası). Tipli tablo blok türü başına bir migration demek.
--   * İlişkisel erişim deseni YOK. Tek sorgu "bu sitenin yayınlanmış sayfasını
--     ver"; kimse "tüm kiracılardaki hero blokları" diye sormuyor.
--   * Sıralama tabloda `sort_order` yeniden yazımı, dizide `splice`.
--
-- JSONB'nin bedeli peşin ödeniyor: `schema_version`, ayrımlı-birleşim DTO
-- doğrulaması (sözlükte olmayan blok türü REDDEDİLİR, saklanmaz), boyut
-- check'i ve kanonik JSON hash'i.
--
-- DAVRANIŞ ayarları JSONB'ye GİRMEZ: randevu motorunun okuduğu anahtarlar
-- (`min_lead`, `hold_ttl`, `show_prices`…) `booking_site_settings`te ilişkisel
-- kalır. Bir slotun alınabilir olup olmadığına karar vermek için doküman
-- ayrıştırmak, sorgulanamayan bir kural demekti.

-- ---------------------------------------------------------------------------
-- İçerik sürümleri
-- ---------------------------------------------------------------------------
create table booking_page_revisions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  booking_site_id uuid not null references booking_sites(id) on delete cascade,

  revision_number integer not null check (revision_number > 0),
  -- Şema sürümü: gelecekteki bir biçim değişikliği, başlangıç noktası BİLİNEN
  -- tek geçişlik bir dönüşüm olsun diye.
  schema_version  integer not null default 1,
  -- Tek dil (tr). İkinci dil = locale başına yeni sürüm satırı; şema değişmez.
  locale          text not null default 'tr' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),

  theme    jsonb not null default '{}'::jsonb,
  sections jsonb not null default '[]'::jsonb,
  seo      jsonb not null default '{}'::jsonb,

  -- Kanonik JSON'un sha256'sı. CDN validator'ı (`ETag`) bundan üretilir;
  -- `JSON.stringify` anahtar sırasına güvenilmez, uygulama kanonik
  -- serileştirici kullanır.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),

  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint booking_page_revisions_sections_is_array check (jsonb_typeof(sections) = 'array'),
  constraint booking_page_revisions_theme_is_object  check (jsonb_typeof(theme) = 'object'),
  constraint booking_page_revisions_seo_is_object    check (jsonb_typeof(seo) = 'object'),
  -- Bir randevu sayfası bir CMS değil. Üst sınır olmasaydı tek bir PUT
  -- veritabanına megabaytlarca metin yazabilirdi.
  constraint booking_page_revisions_size check (
    pg_column_size(sections) + pg_column_size(theme) + pg_column_size(seo) < 262144
  ),
  unique (booking_site_id, revision_number)
);

create index booking_page_revisions_site_idx
  on booking_page_revisions (booking_site_id, revision_number desc);

-- Yayınlanmış içerik DEĞİŞMEZ. Yayın bir pointer taşımadır, geri alma da
-- öyle; "yayındaki metni düzelttim" diye bir işlem yok, yeni sürüm var.
create trigger booking_page_revisions_immutable
  before update or delete on booking_page_revisions
  for each row execute function reject_mutation();

-- Pointer'lar 0035'te FK'sız açılmıştı; tablo doğduğuna göre bağlanıyor.
--
-- `on delete set null`: sürümler zaten silinmiyor (yukarıdaki trigger). Site
-- silindiğinde sürümler cascade ile gider ve pointer'ın kime baktığı önemsiz
-- kalır — kısıtlamayı `restrict` yapmak site silmeyi imkânsızlaştırırdı.
alter table booking_sites
  add constraint booking_sites_published_revision_fk
    foreign key (published_revision_id) references booking_page_revisions(id) on delete set null,
  add constraint booking_sites_draft_revision_fk
    foreign key (draft_revision_id) references booking_page_revisions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Davranış ayarları
-- ---------------------------------------------------------------------------
create type booking_otp_channel as enum ('whatsapp', 'sms');

create table booking_site_settings (
  booking_site_id uuid primary key references booking_sites(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- `null` = kiracı ayarına düş (`tenant_settings`). İki yerde saklanan aynı
  -- varsayılan er ya da geç birbirinden ayrılırdı (8.4'teki aynı karar).
  min_lead_minutes_override    integer check (min_lead_minutes_override between 0 and 43200),
  max_advance_days_override    integer check (max_advance_days_override between 1 and 730),
  cancel_window_hours_override integer check (cancel_window_hours_override between 0 and 720),

  hold_ttl_minutes integer not null default 10 check (hold_ttl_minutes between 1 and 60),

  show_staff_selection boolean not null default true,
  show_prices          boolean not null default true,
  allow_reschedule     boolean not null default true,
  require_otp          boolean not null default true,
  otp_channel          booking_otp_channel not null default 'whatsapp',

  -- Randevu anında gösterilen onam metinleri. 9.4 bunların sha256'sını
  -- `booking_consent_acceptances`a yazar; Faz 7 geldiğinde satırlar
  -- `consent_records`a taşınır.
  consent_texts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(consent_texts) = 'array'),

  locales       text[] not null default '{tr}',
  contact_email text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Görsel varlıklar
-- ---------------------------------------------------------------------------
-- `customer_files` KULLANILAMAZ: `customer_id` NOT NULL, her okuma bir KVKK
-- erişim kaydı yazıyor ve güvenlik duruşu "tıbben hassas, kısa TTL'li imzalı
-- URL" üzerine kurulu. Pazarlama görseli üçünün de tersi.
--
-- TESLİM İMZASIZDIR: imzalı URL süresi dolduğu için cache anahtarı çürür, yani
-- CDN bir hero görselini asla cache'leyemez ve her render N imzalama maliyeti
-- çıkarır. Anahtar içerik hash'i taşıdığı için logo değişince URL değişir ve
-- purge denklemden çıkar (`max-age=31536000, immutable`).
create type tenant_asset_purpose as enum
  ('booking_logo', 'booking_hero', 'booking_gallery', 'service_image', 'favicon', 'og_image');
create type tenant_asset_status as enum ('pending', 'ready');

create table tenant_assets (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  purpose     tenant_asset_purpose not null,
  storage_key text not null unique,

  -- SVG YOK: kendi alan adımızdan servis edilen bir SVG saklı XSS'tir.
  -- Sanitizasyon Faz 9 kapsamı değil; kapsam dışı bırakmak sanitize etmeye
  -- çalışıp yanlış yapmaktan iyidir.
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
  ),
  size_bytes bigint not null check (size_bytes > 0),
  width      integer check (width > 0),
  height     integer check (height > 0),
  sha256     text check (sha256 ~ '^[0-9a-f]{64}$'),
  alt_text   text,

  status     tenant_asset_status not null default 'pending',
  created_by uuid references users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index tenant_assets_tenant_idx
  on tenant_assets (tenant_id, purpose) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- RLS, trigger'lar ve yetkiler
-- ---------------------------------------------------------------------------
-- DİKKAT: bu tabloların HİÇBİRİNDE `current_public_flow()` geçmez. İçerik
-- tabloları taslak, iç not ve yayınlanmamış deneme taşır; public bayrağın
-- onlara erişmesi bayrağın etki alanını dört kolondan bütün bir CMS'e
-- genişletirdi. Public okuma, kiracı `PublicSiteGuard` tarafından çözüldükten
-- SONRA olağan izolasyon politikası altında yapılır.
alter table booking_page_revisions enable row level security;
alter table booking_page_revisions force row level security;
create policy booking_page_revisions_isolation on booking_page_revisions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table booking_site_settings enable row level security;
alter table booking_site_settings force row level security;
create policy booking_site_settings_isolation on booking_site_settings
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table tenant_assets enable row level security;
alter table tenant_assets force row level security;
create policy tenant_assets_isolation on tenant_assets
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger booking_site_settings_set_updated_at
  before update on booking_site_settings for each row execute function set_updated_at();
create trigger tenant_assets_set_updated_at
  before update on tenant_assets for each row execute function set_updated_at();

create trigger booking_site_settings_audit
  after insert or update or delete on booking_site_settings
  for each row execute function audit_row_change('tenant_id');
-- `booking_page_revisions` denetime BAĞLANMADI: satırlar zaten değişmez ve
-- her sürüm `created_by` + `created_at` taşıyor. Denetim kaydı yalnız içeriğin
-- ikinci bir kopyasını üretirdi.

grant select, insert on booking_page_revisions to klinara_app;
revoke update, delete on booking_page_revisions from klinara_app;
grant select, insert, update, delete on booking_site_settings to klinara_app;
grant select, insert, update, delete on tenant_assets to klinara_app;
