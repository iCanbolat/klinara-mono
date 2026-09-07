-- Faz 10.3 — Platform (destek) erişiminin KAYDI.
--
-- `PLATFORM_ADMIN_TOKEN` kiracı-üstü bir anahtardır: taşıyanı hiçbir kiracıya
-- ait olmadan kiracı açabilir ve RLS'in `app.platform_admin` bayrağını
-- kaldırabilir. Bugüne kadar bu erişimin İZİ YOKTU — `audit_log` yalnız satır
-- değişikliklerini görür, "destek ekibi ne zaman, hangi ucu, neden çağırdı"
-- sorusunun cevabı hiçbir yerde durmuyordu.
--
-- Tablo kiracıya ait DEĞİLDİR (kayıt zaten kiracı-üstü bir erişimi anlatır),
-- bu yüzden `tenant_id` yok; okuma yine de RLS ile kapalı: yalnız platform
-- bağlamı görebilir.
create table platform_access_log (
  id               bigserial   primary key,
  occurred_at      timestamptz not null default now(),
  request_id       text,
  method           text        not null,
  -- Sırlarından arındırılmış yol (bkz. `sanitizeUrl`).
  path             text        not null,
  -- Destek erişiminin GEREKÇESİ. Zorunludur: gerekçesiz erişim, sonradan
  -- "neden bakılmış" sorusunu cevaplanamaz hâle getirir.
  reason           text        not null,
  client_ip        text,
  user_agent       text,
  -- Token'ın geçerlilik sonu; erişimin süreli olduğunun kaydı.
  token_expires_at timestamptz
);

create index platform_access_log_time_idx on platform_access_log (occurred_at desc);

alter table platform_access_log enable row level security;
alter table platform_access_log force row level security;

create policy platform_access_log_read on platform_access_log
  for select
  using (current_setting('app.platform_admin', true) = 'on');

-- Yazma politikası `audit_log`daki ile aynı gerekçeye sahip: kayıt uygulama
-- rolüyle, kiracı bağlamı OLMADAN yazılır.
create policy platform_access_log_insert on platform_access_log
  for insert
  with check (true);

-- Erişim kaydı KANITTIR: değiştirilemez, silinemez.
create trigger platform_access_log_immutable
  before update or delete on platform_access_log
  for each row execute function reject_mutation();

grant select, insert on platform_access_log to klinara_app;
grant usage, select on sequence platform_access_log_id_seq to klinara_app;
