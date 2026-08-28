-- Batch 8.2 — WhatsApp Cloud API entegrasyonu (giden).
--
-- Resmî Meta Graph API kullanılır, BSP aracı yok (mimari karar 4.6).
--
-- Üç şey şemaya gömülüdür:
--   1. Erişim token'ı ŞİFRELİ durur (`FieldEncryptionService`, AES-256-GCM).
--      DB dump'ı tek başına kiracının WhatsApp hesabını ele geçirmeye yetmez.
--   2. Template LİSTESİ bizim değil Meta'nın gerçeğidir; buradaki satırlar bir
--      YANSIMADIR (`synced_at`). Onaysız bir template'le gönderim denemek
--      kalıcı hatadır ve kuyruğu meşgul etmemesi için önceden bilinmelidir.
--   3. 24 saatlik müşteri hizmetleri penceresi bir TABLO ile modellenir.
--      Kural kodda "hatırlanan" bir şey olsaydı, unutulduğu ilk yerde Meta
--      mesajı reddederdi ve sebebi görünmezdi.

create type whatsapp_account_status as enum ('unconfigured', 'active', 'error');
create type whatsapp_template_status as enum ('pending', 'approved', 'rejected');

create table whatsapp_accounts (
  tenant_id uuid primary key references tenants(id) on delete cascade,

  waba_id         text not null,
  phone_number_id text not null,
  -- Kiracının WhatsApp'ta görünen numarası (E.164). Gönderimde kullanılmaz,
  -- yapılandırmanın doğru hesaba bağlandığını GÖSTERMEK içindir.
  business_phone  text,

  -- `<keyId>:<iv>:<tag>:<ciphertext>` — anahtar rotasyonu satır bazında.
  access_token_encrypted text not null,
  -- Webhook imzası (8.3) bu sırla doğrulanır.
  app_secret_encrypted   text,

  api_version text not null default 'v21.0',
  status      whatsapp_account_status not null default 'unconfigured',
  last_verified_at timestamptz,
  last_error  text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Gelen webhook kiracıyı `waba_id` üzerinden çözer (8.3); bir WABA hesabı
-- yalnız TEK kiracıya ait olabilir.
create unique index whatsapp_accounts_waba_key on whatsapp_accounts (waba_id);

create table whatsapp_templates (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  name     text not null,
  language text not null default 'tr',
  category text,
  status   whatsapp_template_status not null default 'pending',
  -- Gövdedeki `{{1}}`, `{{2}}` sayısı: şablon değişkenleriyle eşleşmezse
  -- Meta mesajı reddeder.
  body_variable_count integer not null default 0,
  buttons  jsonb not null default '[]'::jsonb,
  synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index whatsapp_templates_key
  on whatsapp_templates (tenant_id, name, language);

-- 24 saatlik müşteri hizmetleri penceresi.
--
-- Müşteri yazdığında pencere açılır (8.3 doldurur) ve 24 saat serbest metin
-- gönderilebilir; kapalıyken YALNIZ onaylı template gider. Tablo boşken
-- pencere kapalı sayılır — güvenli varsayılan budur.
create table whatsapp_contact_windows (
  tenant_id uuid not null references tenants(id) on delete cascade,
  phone     text not null,
  last_inbound_at timestamptz not null,
  primary key (tenant_id, phone)
);

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table whatsapp_accounts enable row level security;
alter table whatsapp_accounts force row level security;
create policy whatsapp_accounts_isolation on whatsapp_accounts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table whatsapp_templates enable row level security;
alter table whatsapp_templates force row level security;
create policy whatsapp_templates_isolation on whatsapp_templates
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table whatsapp_contact_windows enable row level security;
alter table whatsapp_contact_windows force row level security;
create policy whatsapp_contact_windows_isolation on whatsapp_contact_windows
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger whatsapp_accounts_set_updated_at
  before update on whatsapp_accounts for each row execute function set_updated_at();
create trigger whatsapp_templates_set_updated_at
  before update on whatsapp_templates for each row execute function set_updated_at();

-- Denetim: token değişimi kimin elinden geçti sorusu bir güvenlik sorusudur.
-- `audit_log` şifreli metni saklar, düz metni değil.
create trigger whatsapp_accounts_audit
  after insert or update or delete on whatsapp_accounts
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on whatsapp_accounts to klinara_app;
grant select, insert, update, delete on whatsapp_templates to klinara_app;
grant select, insert, update, delete on whatsapp_contact_windows to klinara_app;

-- ---------------------------------------------------------------------------
-- Bildirim çekirdeğine WhatsApp'a özgü iki alan
-- ---------------------------------------------------------------------------
-- Meta template'i KONUMSAL değişken kullanır (`{{1}}`, `{{2}}`); bizim
-- şablonlarımız ADLI (`{{customerName}}`). Eşleme bir yerde durmak zorunda ve
-- doğru yer şablon satırıdır: sıra değişince gönderim kodu değil, şablon
-- güncellenir.
alter table notification_templates
  add column whatsapp_variables text[] not null default '{}';

-- Template gönderiminde Meta'ya DEĞERLERİN KENDİSİ gider; render edilmiş
-- gövde yetmez. Kuyrukta bekleyen bir mesajın parametreleri bu yüzden
-- saklanıyor. Kişisel veri içerir — `rendered_body` zaten içeriyordu, yeni bir
-- kategori açmıyor; saklama süresi politikası ikisini birlikte kapsar (7.4).
alter table message_log
  add column template_variables jsonb;
