-- Oturumlar, refresh token'lar ve giriş denemeleri (Batch 1.2).
--
-- Model: bir OTURUM bir refresh token AİLESİdir. Rotation her yenilemede yeni
-- bir token üretir ve eskisini "kullanıldı" işaretler; kullanılmış bir token
-- ikinci kez gelirse (çalınmış olabilir) ailenin tamamı iptal edilir.

create type session_auth_method as enum ('password', 'passkey', 'invitation', 'password_reset');
create type session_mfa_method  as enum ('totp', 'backup_code', 'passkey');

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id)   on delete cascade,
  -- Oturum bir KİRACIYA bağlıdır: aynı kullanıcı iki klinikte çalışıyorsa iki
  -- ayrı oturumu olur ve birinden çıkması diğerini düşürmez.
  tenant_id     uuid not null references tenants(id) on delete cascade,
  auth_method   session_auth_method not null,
  mfa_method    session_mfa_method,
  ip            inet,
  user_agent    text,
  device_label  text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_reason text
);

create index sessions_user_idx on sessions (user_id, created_at desc);
create index sessions_active_idx on sessions (user_id, tenant_id) where revoked_at is null;

create table refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  -- DÜZ METİN SAKLANMAZ. Veritabanı dökümü ele geçse bile token yeniden
  -- üretilemez; gelen token sha256'lanıp burada aranır.
  token_hash text not null unique,
  -- Rotation zinciri: hangi token'dan türedi. Yeniden kullanım tespitinde
  -- ailenin kökünü bulmak için değil, ADLİ İZ için tutulur; iptal zaten
  -- oturum (aile) seviyesindedir.
  parent_id  uuid references refresh_tokens(id) on delete set null,
  used_at    timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index refresh_tokens_session_idx on refresh_tokens (session_id, created_at desc);

create table login_attempts (
  id         bigserial primary key,
  -- Normalize edilmiş tanımlayıcı: e-posta veya E.164 telefon. Hesap var olmasa
  -- bile yazılır — aksi hâlde var olmayan kullanıcı adlarıyla yapılan deneme
  -- sınırsız kalırdı.
  identifier citext not null,
  user_id    uuid references users(id) on delete set null,
  succeeded  boolean not null,
  reason     text,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index login_attempts_identifier_idx on login_attempts (identifier, created_at desc);
create index login_attempts_ip_idx on login_attempts (ip, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Oturum ve token satırları KİRACI verisi değil, KULLANICI verisidir. Bir
-- kiracı yöneticisinin, personelinin oturum token'ını okuyabilmesi için hiçbir
-- gerekçe yok — bu yüzden politika üyeliğe değil, aktörün kendisine bakar.

alter table sessions enable row level security;
alter table sessions force row level security;
create policy sessions_own on sessions
  for all
  using (current_auth_flow() or user_id = current_actor_id())
  with check (current_auth_flow() or user_id = current_actor_id());

alter table refresh_tokens enable row level security;
alter table refresh_tokens force row level security;
-- Refresh token'a YALNIZ kimlik akışı dokunur: istek bağlamında (access token
-- ile) refresh token okumanın meşru bir sebebi yoktur.
create policy refresh_tokens_auth_only on refresh_tokens
  for all
  using (current_auth_flow())
  with check (current_auth_flow());

alter table login_attempts enable row level security;
alter table login_attempts force row level security;
create policy login_attempts_auth_only on login_attempts
  for all
  using (current_auth_flow())
  with check (current_auth_flow());

grant select, insert, update, delete on sessions, refresh_tokens, login_attempts to klinara_app;
grant usage, select on sequence login_attempts_id_seq to klinara_app;
