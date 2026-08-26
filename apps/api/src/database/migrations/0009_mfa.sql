-- TOTP (opsiyonel ikinci faktör) ve yedek kodlar (Batch 1.4).
--
-- TOTP sırrı, parolanın aksine, DOĞRULANABİLİR olmak zorundadır: hash'lenemez,
-- geri okunması gerekir. Bu yüzden uygulama seviyesinde AES-256-GCM ile
-- şifrelenir; anahtar env/KMS'ten gelir. Veritabanı dökümü tek başına ikinci
-- faktörü kırmaya yetmez.

create table user_totp_secrets (
  user_id          uuid primary key references users(id) on delete cascade,
  secret_encrypted text        not null,
  -- Anahtar rotasyonu için: eski anahtarla şifrelenmiş satırlar okunmaya devam
  -- eder, yeni yazımlar yeni anahtarı kullanır.
  key_id           text        not null,
  confirmed_at     timestamptz,
  -- Kullanılmış TOTP adımı. Aynı kod 30 saniye boyunca geçerlidir; bu alan
  -- olmadan ağı dinleyen biri kodu aynı pencerede TEKRAR kullanabilirdi.
  last_used_step   bigint,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table user_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  -- Yedek kod da bir paroladır: hash'li saklanır, tek kullanımlıktır.
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

create index user_backup_codes_user_idx on user_backup_codes (user_id) where used_at is null;

-- Kiracı yöneticileri için 2FA zorunluluğu. Varsayılan KAPALI — TOTP
-- opsiyoneldir, kiracı isterse yönetici rolleri için zorunlu kılar.
alter table tenant_settings
  add column require_mfa_for_admins boolean not null default false;

alter table user_totp_secrets enable row level security;
alter table user_totp_secrets force row level security;
create policy user_totp_secrets_own on user_totp_secrets
  for all
  using (current_auth_flow() or user_id = current_actor_id())
  with check (current_auth_flow() or user_id = current_actor_id());

alter table user_backup_codes enable row level security;
alter table user_backup_codes force row level security;
create policy user_backup_codes_own on user_backup_codes
  for all
  using (current_auth_flow() or user_id = current_actor_id())
  with check (current_auth_flow() or user_id = current_actor_id());

create trigger user_totp_secrets_set_updated_at
  before update on user_totp_secrets for each row execute function set_updated_at();

-- Denetim kaydı 2FA'nın AÇILDIĞINI/KAPANDIĞINI tutar; sırrı değil.
create trigger user_totp_secrets_audit
  after insert or update or delete on user_totp_secrets
  for each row execute function audit_row_change_redacted('tenant_id', 'secret_encrypted');

grant select, insert, update, delete on user_totp_secrets, user_backup_codes to klinara_app;
