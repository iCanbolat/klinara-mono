-- Telefon doğrulama — SMS (Batch 1.5).
--
-- Telefon MOBİLİN birincil giriş tanımlayıcısıdır ama SMS bir giriş FAKTÖRÜ
-- DEĞİLDİR: yalnız numaranın kime ait olduğunu doğrular. İspat passkey ya da
-- paroladan gelir (SIM swap / SS7 riski; NIST SP 800-63B SMS'i zayıf sayar).

alter table users add column phone text;
alter table users add column phone_verified_at timestamptz;

-- E.164: '+' ve 8-15 hane. Normalizasyon uygulamada (libphonenumber) yapılır;
-- buradaki check son savunma hattıdır.
alter table users add constraint users_phone_e164
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

-- Doğrulanmamış numara kimlik değil, sadece bir iletişim alanıdır — bu yüzden
-- tekillik YALNIZ doğrulanmış numaralar arasında aranır. Aksi hâlde bir
-- kullanıcı başkasının numarasını profiline yazarak o numarayı "rezerve"
-- edebilirdi.
create unique index users_phone_verified_key
  on users (phone)
  where phone_verified_at is not null and deleted_at is null;

create table phone_verification_codes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  phone          text not null,
  -- Kod DÜZ METİN saklanmaz (sha256). Destek ekibi dahil kimse kodu okuyamaz.
  code_hash      text not null,
  attempts       integer     not null default 0,
  max_attempts   integer     not null default 5,
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  -- Deneme hakkı dolduğunda kod KOMPLE yanar; yeni kod istenmesi gerekir.
  invalidated_at timestamptz,
  created_at     timestamptz not null default now()
);

create index phone_verification_codes_user_idx
  on phone_verification_codes (user_id, created_at desc);
create index phone_verification_codes_active_idx
  on phone_verification_codes (user_id)
  where consumed_at is null and invalidated_at is null;

alter table phone_verification_codes enable row level security;
alter table phone_verification_codes force row level security;
create policy phone_verification_codes_own on phone_verification_codes
  for all
  using (current_auth_flow() or user_id = current_actor_id())
  with check (current_auth_flow() or user_id = current_actor_id());

grant select, insert, update, delete on phone_verification_codes to klinara_app;
