-- Batch 9.4 — slot tutma, telefon doğrulama ve geçici onam kaydı.
--
-- ÇEKİRDEK GARANTİ 0018'de zaten kuruldu ve burada YENİDEN YAZILMIYOR:
-- tutma, randevunun kullandığı `resource_bookings_no_overlap` GIST EXCLUDE
-- constraint'inin ta kendisi tarafından korunuyor. `booking_source` enum'unda
-- `'hold'`, `resource_bookings`ta `hold_id` kolonu ve kaynak check'i 0018'den
-- beri bekliyordu; bu migration yalnız FK'yi kapatıyor.
--
-- Ayrı bir "hold çakışması" kontrolü YAZILMADI: uygulama seviyesinde bir kilit,
-- iki eş zamanlı isteğin ikisini de geçirebileceği bir kilittir. Tutma ile
-- randevu aynı constraint'ten geçmezse, online randevu ile iç panelden açılan
-- randevu birbirini görmezdi.

create type slot_hold_status as enum ('active', 'released', 'expired', 'converted');

create table slot_holds (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  booking_site_id uuid not null references booking_sites(id) on delete cascade,

  -- Token DÜZ METİN saklanmaz. Bir hold token'ı slotu rehin alma yetkisidir;
  -- veritabanı yedeğinden okunabilir olmasının bir gerekçesi yok.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  -- Seçilen hizmetler (sıra korunur) ve blok. Randevuya dönüşürken plan
  -- BURADAN değil, planlayıcıdan yeniden hesaplanır; bu satır ne istendiğinin
  -- kaydıdır, ne yazılacağının değil.
  service_ids      uuid[] not null check (array_length(service_ids, 1) between 1 and 10),
  staff_profile_id uuid references staff_profiles(id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,

  status     slot_hold_status not null default 'active',
  expires_at timestamptz not null,

  -- OTP doğrulaması hold'a BAĞLANIR. Ayrı bir "doğrulanmış telefon token'ı"
  -- üretmek, ortalıkta dolaşan ve başka bir hold'a takılabilecek ikinci bir
  -- sır demekti.
  otp_verified_at timestamptz,
  verified_phone  text,

  -- Slot işgali (squatting) sınırı bu iki kolondan hesaplanır.
  client_ip  inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint slot_holds_range check (ends_at > starts_at),
  constraint slot_holds_verified_needs_phone check (
    otp_verified_at is null or verified_phone is not null
  )
);

create index slot_holds_expiry_idx on slot_holds (expires_at) where status = 'active';
create index slot_holds_site_idx on slot_holds (booking_site_id, status);
-- Aynı IP'nin aktif tutmalarını saymak için.
create index slot_holds_client_idx on slot_holds (client_ip, status) where status = 'active';
create index slot_holds_phone_idx on slot_holds (verified_phone, status) where status = 'active';

-- 0018'de bilerek FK'sız bırakılan kolon kapanıyor.
--
-- `on delete cascade`: hold satırı silinirse onu temsil eden rezervasyon da
-- gitmeli. Pratikte hold silinmiyor (durumu değişiyor) ama FK'nin davranışı
-- yine de tanımlı olmalı.
alter table resource_bookings
  add constraint resource_bookings_hold_fk
    foreign key (hold_id) references slot_holds(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Telefon doğrulaması
-- ---------------------------------------------------------------------------
-- `phone_verification_codes` (0010) KULLANILAMAZ: o tablo `user_id`ye bağlı ve
-- politikası `current_actor_id()` okuyor. Randevu alan müşterinin kullanıcı
-- hesabı yok ve olmayacak (bkz. bölüm 10 — SMS ile giriş kapsam dışı).
create table booking_otp_challenges (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  booking_site_id uuid not null references booking_sites(id) on delete cascade,
  slot_hold_id    uuid not null references slot_holds(id) on delete cascade,

  -- E.164. Hız sınırı sorguları bu kolondan geçer.
  phone     text not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),

  attempts    integer not null default 0 check (attempts >= 0),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  -- Ardışık hatalı denemede kod KOMPLE yanar: kalan denemeleri saymak yerine
  -- satırı işaretlemek, "5. denemede bildi" gibi bir yolu baştan kapatır.
  burned_at   timestamptz,
  client_ip   inet,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bir hold için aynı anda tek AÇIK kod. Yeniden gönderim eskisini yakar.
create unique index booking_otp_challenges_open_key
  on booking_otp_challenges (slot_hold_id)
  where consumed_at is null and burned_at is null;

-- Telefon ve site bazlı günlük tavan sorguları.
create index booking_otp_challenges_phone_idx
  on booking_otp_challenges (tenant_id, phone, created_at);
create index booking_otp_challenges_site_idx
  on booking_otp_challenges (booking_site_id, created_at);

-- ---------------------------------------------------------------------------
-- Onam — GEÇİCİ STUB (Faz 7'ye köprü)
-- ---------------------------------------------------------------------------
-- Faz 7 (onam/KVKK) bu fazdan SONRA geliyor. Bu tablo bugünden KANIT topluyor:
-- müşteriye gösterilen metnin birebir kopyası, sha256'sı, IP/user-agent ve
-- zaman damgası. Batch 7.2 bu satırları `consent_records`a taşıyacak ve
-- `consent_record_id`yi dolduracak — hiçbir kanıt kaybolmaz, yalnız şablon
-- SÜRÜMÜNE bağlanması gecikir.
--
-- Kayıtlar DEĞİŞMEZ: bir onam kanıtı sonradan düzeltilebiliyorsa kanıt değildir.
create table booking_consent_acceptances (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  booking_site_id uuid not null references booking_sites(id) on delete cascade,
  appointment_id  uuid references appointments(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,

  kind        text not null check (length(trim(kind)) > 0),
  -- Gösterilen metnin BİREBİR kopyası. Ayarlardaki metin sonradan değişse bile
  -- "bu müşteriye ne gösterildi" sorusu cevaplanabilir kalır.
  text_body   text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),

  accepted_at timestamptz not null default now(),
  ip          inet,
  user_agent  text,

  -- Faz 7.2 dolduracak.
  consent_record_id uuid,

  created_at timestamptz not null default now()
);

create index booking_consent_acceptances_appointment_idx
  on booking_consent_acceptances (tenant_id, appointment_id);
-- 7.2'nin taşıyacağı küme: henüz `consent_records`a bağlanmamış satırlar.
create index booking_consent_acceptances_unmigrated_idx
  on booking_consent_acceptances (tenant_id) where consent_record_id is null;

create trigger booking_consent_acceptances_immutable
  before update or delete on booking_consent_acceptances
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS, trigger'lar ve yetkiler
-- ---------------------------------------------------------------------------
alter table slot_holds enable row level security;
alter table slot_holds force row level security;
create policy slot_holds_isolation on slot_holds
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table booking_otp_challenges enable row level security;
alter table booking_otp_challenges force row level security;
create policy booking_otp_challenges_isolation on booking_otp_challenges
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table booking_consent_acceptances enable row level security;
alter table booking_consent_acceptances force row level security;
create policy booking_consent_acceptances_isolation on booking_consent_acceptances
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger slot_holds_set_updated_at
  before update on slot_holds for each row execute function set_updated_at();
create trigger booking_otp_challenges_set_updated_at
  before update on booking_otp_challenges for each row execute function set_updated_at();

-- `slot_holds` denetime bağlı: "bu slot neden doluydu?" sorusunun cevabı.
create trigger slot_holds_audit
  after insert or update or delete on slot_holds
  for each row execute function audit_row_change('tenant_id');
-- `booking_otp_challenges` denetime BAĞLANMADI: kod hash'i ve telefon
-- numarası denetim kaydına ikinci kez kopyalanmamalı (`message_log`taki aynı
-- gerekçe, 0031).

grant select, insert, update on slot_holds to klinara_app;
-- Tutma SİLİNMEZ: süresi dolmuş bir hold, "o slot neden alınamadı" sorusunun
-- kanıtıdır.
revoke delete on slot_holds from klinara_app;
grant select, insert, update on booking_otp_challenges to klinara_app;
revoke delete on booking_otp_challenges from klinara_app;
grant select, insert on booking_consent_acceptances to klinara_app;
revoke update, delete on booking_consent_acceptances from klinara_app;
