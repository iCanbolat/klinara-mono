-- Passkey (WebAuthn / FIDO2) — mobilde sürtünmesiz giriş (Batch 1.6).
--
-- Sunucu YALNIZ AÇIK ANAHTARI saklar. Özel anahtar cihazın güvenli donanımından
-- (Secure Enclave / StrongBox) hiç çıkmaz; veritabanı sızsa bile giriş yapılamaz.
-- Passkey oltalamaya YAPISAL olarak dayanıklıdır: imza `rpId`ye bağlıdır, sahte
-- bir alan adı geçerli imza üretemez.

create table user_passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  -- base64url. Global tekil: aynı credential iki hesaba bağlanamaz.
  credential_id text not null unique,
  public_key    bytea not null,
  -- Klonlanmış authenticator tespiti: sayaç GERİLERSE doğrulama reddedilir.
  sign_count    bigint not null default 0,
  transports    text[],
  aaguid        uuid,
  backed_up     boolean not null default false,
  device_label  text not null default 'Cihaz',
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index user_passkeys_user_idx on user_passkeys (user_id, created_at desc);

create type webauthn_purpose as enum ('registration', 'authentication');

create table webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  challenge   text not null unique,
  -- Discoverable credential ile girişte kullanıcı HENÜZ bilinmez; sunucu
  -- challenge üretir, kimin imzaladığını yanıt söyler.
  user_id     uuid references users(id) on delete cascade,
  purpose     webauthn_purpose not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index webauthn_challenges_expiry_idx on webauthn_challenges (expires_at);

alter table user_passkeys enable row level security;
alter table user_passkeys force row level security;
-- Kayıt/silme oturum açmış kullanıcıya, doğrulama kimlik akışına aittir.
create policy user_passkeys_own on user_passkeys
  for all
  using (current_auth_flow() or user_id = current_actor_id())
  with check (current_auth_flow() or user_id = current_actor_id());

alter table webauthn_challenges enable row level security;
alter table webauthn_challenges force row level security;
create policy webauthn_challenges_access on webauthn_challenges
  for all
  using (current_auth_flow() or user_id = current_actor_id())
  with check (current_auth_flow() or user_id = current_actor_id());

create trigger user_passkeys_set_updated_at
  before update on user_passkeys for each row execute function set_updated_at();

-- Açık anahtar sır değildir ama denetim kaydını şişirir; dışarıda bırakılır.
create trigger user_passkeys_audit
  after insert or update or delete on user_passkeys
  for each row execute function audit_row_change_redacted('tenant_id', 'public_key');

grant select, insert, update, delete on user_passkeys, webauthn_challenges to klinara_app;
