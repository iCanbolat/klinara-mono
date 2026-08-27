-- Faz 3.1 — Randevu şeması ve çakışma garantisi.
--
-- Bu migration'ın tek amacı, veritabanının YANLIŞ VERİYİ KABUL ETMEMESİDİR.
-- Uygulama katmanı burada hiçbir garanti taşımaz; taşısaydı bir gün unutulurdu.
--
-- Üç garanti:
--   1. Aynı personel, kesişen iki aktif zaman  → EXCLUDE constraint reddeder.
--   2. Geçersiz durum geçişi                   → trigger reddeder (K0001).
--   3. Yetkin olmayan personele randevu        → trigger reddeder (K0003).

create type appointment_status as enum (
  'scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'no_show', 'cancelled'
);
create type appointment_origin as enum ('internal', 'online');
create type resource_type     as enum ('staff');
create type booking_source    as enum ('appointment', 'hold');

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
create table appointments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id)  on delete cascade,
  branch_id           uuid not null references branches(id) on delete restrict,
  customer_id         uuid not null references customers(id) on delete restrict,
  status              appointment_status not null default 'scheduled',
  -- MÜŞTERİYE GÖSTERİLEN aralık. Hazırlık/temizlik payı BURADA DEĞİL,
  -- `resource_bookings.time_range` içindedir: müşteri 14:00 randevusunu görür,
  -- takvim ise 13:55–15:10'u dolu tutar.
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  origin              appointment_origin not null default 'internal',
  notes               text,
  cancellation_reason text,
  cancelled_by        uuid references users(id) on delete set null,
  cancelled_at        timestamptz,
  created_by          uuid references users(id) on delete set null,
  -- Optimistic locking (API sözleşmesi 5.7): `ETag` / `If-Match`.
  version             integer     not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint appointments_time_order check (ends_at > starts_at),
  -- İptal alanları durumla tutarlı olmak zorunda: "iptal ama iptal eden yok"
  -- ya da "iptal değil ama iptal tarihi dolu" gibi kayıtlar oluşamaz.
  constraint appointments_cancel_fields check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);

create index appointments_branch_time_idx
  on appointments (tenant_id, branch_id, starts_at)
  where deleted_at is null;

create index appointments_customer_time_idx
  on appointments (tenant_id, customer_id, starts_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- appointment_services — randevunun hizmet kalemleri
-- ---------------------------------------------------------------------------
-- Fiyat, süre ve buffer değerleri SNAPSHOT'tır. Katalogdaki hizmet sonradan
-- zamlanırsa geçmiş randevunun tutarı değişmemelidir; tahsilat ve prim
-- hesapları bu satırlara dayanır.
create table appointment_services (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  appointment_id        uuid not null references appointments(id) on delete cascade,
  service_id            uuid not null references services(id) on delete restrict,
  staff_profile_id      uuid not null references staff_profiles(id) on delete restrict,
  sort_order            integer     not null default 0,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  duration_minutes      integer     not null check (duration_minutes > 0),
  buffer_before_minutes integer     not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes  integer     not null default 0 check (buffer_after_minutes >= 0),
  price_minor           bigint      not null check (price_minor >= 0),
  vat_rate_basis_points integer     not null default 2000
                          check (vat_rate_basis_points between 0 and 10000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint appointment_services_time_order check (ends_at > starts_at)
);

create unique index appointment_services_order_key
  on appointment_services (appointment_id, sort_order);

create index appointment_services_staff_time_idx
  on appointment_services (staff_profile_id, starts_at);

-- ---------------------------------------------------------------------------
-- resource_bookings — ÇEKİRDEK GARANTİ
-- ---------------------------------------------------------------------------
-- Tüm zaman işgali (randevu ve Faz 9'daki geçici slot tutma) TEK tabloda
-- toplanır. Tek bir EXCLUDE constraint hepsini birden kapsar; "izin günü
-- randevu alınabildi" sınıfı hatalar yapısal olarak imkânsız hâle gelir.
create table resource_bookings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id)  on delete cascade,
  branch_id      uuid not null references branches(id) on delete restrict,
  resource_type  resource_type  not null,
  resource_id    uuid           not null,
  source_type    booking_source not null,
  appointment_id uuid references appointments(id) on delete cascade,
  -- `slot_holds` tablosu Faz 9'da gelir; foreign key o migration'da eklenecek.
  -- Kolonun şimdi durması, EXCLUDE constraint'inin geçici tutmaları da
  -- kapsayacağı sözleşmesini şemada görünür kılar.
  hold_id        uuid,
  -- HAZIRLIK/TEMİZLİK PAYI DAHİL aralık, daima `[)`: sırt sırta randevular
  -- çakışmaz.
  time_range     tstzrange   not null,
  active         boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint resource_bookings_source_ck check (
    (source_type = 'appointment' and appointment_id is not null and hold_id is null) or
    (source_type = 'hold'        and hold_id is not null        and appointment_id is null)
  ),

  constraint resource_bookings_no_overlap exclude using gist (
    tenant_id   with =,
    resource_id with =,
    time_range  with &&
  ) where (active)
);

create index resource_bookings_lookup_idx
  on resource_bookings using gist (resource_id, time_range)
  where (active);

create index resource_bookings_appointment_idx
  on resource_bookings (appointment_id)
  where appointment_id is not null;

-- ---------------------------------------------------------------------------
-- customer_bookings — müşterinin kendi çakışması
-- ---------------------------------------------------------------------------
-- Bu kural KİRACIYA GÖRE değişir (bazı merkezlerde iki kabin paralel çalışır),
-- bu yüzden satır yalnız `tenant_settings.prevent_customer_double_booking`
-- açıkken yazılır. Kural açıkken garanti yine veritabanındadır.
create table customer_bookings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  time_range     tstzrange   not null,
  active         boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint customer_bookings_no_overlap exclude using gist (
    tenant_id with =, customer_id with =, time_range with &&
  ) where (active)
);

create index customer_bookings_appointment_idx on customer_bookings (appointment_id);

-- ---------------------------------------------------------------------------
-- Durum makinesi — izinli geçişler REFERANS VERİDİR
-- ---------------------------------------------------------------------------
-- `required_permission` veritabanında ZORLANMAZ (PostgreSQL izinlerimizi
-- bilmez); servis katmanı bu kolonu okuyup kontrol eder. Trigger'ın işi
-- geçişin var olup olmadığıdır — yani son savunma hattı.
create table appointment_status_transitions (
  from_status         appointment_status not null,
  to_status           appointment_status not null,
  required_permission text,
  primary key (from_status, to_status)
);

insert into appointment_status_transitions (from_status, to_status, required_permission) values
  ('scheduled',   'confirmed',   null),
  ('scheduled',   'arrived',     null),
  ('confirmed',   'arrived',     null),
  ('arrived',     'in_progress', null),
  ('in_progress', 'completed',   null),
  ('scheduled',   'no_show',     null),
  ('confirmed',   'no_show',     null),
  ('arrived',     'no_show',     null),
  ('scheduled',   'cancelled',   null),
  ('confirmed',   'cancelled',   null),
  ('arrived',     'cancelled',   null),
  ('in_progress', 'cancelled',   null),
  -- Tamamlanmış randevuya dokunmak ayrı bir yetkidir: seans hakkı tüketilmiş,
  -- tahsilat açılmış olabilir. Geri açmak da iptal etmek de ters kayıt üretir.
  ('completed',   'in_progress', 'appointment:reopen'),
  ('completed',   'cancelled',   'appointment:reopen');

-- ---------------------------------------------------------------------------
-- Trigger'lar
-- ---------------------------------------------------------------------------

create or replace function appointments_validate_scope() returns trigger
language plpgsql as $$
declare
  v_branch_tenant   uuid;
  v_customer_tenant uuid;
begin
  select tenant_id into v_branch_tenant   from branches  where id = new.branch_id;
  select tenant_id into v_customer_tenant from customers where id = new.customer_id;

  if v_branch_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if v_customer_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create or replace function appointment_services_validate_scope() returns trigger
language plpgsql as $$
declare
  v_appointment_tenant uuid;
  v_appointment_branch uuid;
  v_service_tenant     uuid;
  v_service_active     boolean;
  v_profile_tenant     uuid;
  v_profile_active     boolean;
  v_competent          boolean;
begin
  select tenant_id, branch_id into v_appointment_tenant, v_appointment_branch
    from appointments where id = new.appointment_id;
  select tenant_id, is_active into v_service_tenant, v_service_active
    from services where id = new.service_id;
  select tenant_id, is_active into v_profile_tenant, v_profile_active
    from staff_profiles where id = new.staff_profile_id;

  if v_appointment_tenant is distinct from new.tenant_id
     or v_service_tenant  is distinct from new.tenant_id
     or v_profile_tenant  is distinct from new.tenant_id then
    raise exception 'Randevu kalemi başka bir kiracının kaydına bağlanamaz.'
      using errcode = 'check_violation';
  end if;

  if v_service_active is not true or v_profile_active is not true then
    raise exception 'Pasif hizmet veya pasif personel ile randevu oluşturulamaz.'
      using errcode = 'K0002';
  end if;

  -- YETKİNLİK: Batch 2.2'nin "Faz 3'te zorlanır" maddesi burada kapanıyor.
  -- `branch_id is null` = kiracı geneli yetkinlik, tüm şubeleri kapsar.
  select exists (
    select 1
      from staff_services ss
     where ss.staff_profile_id = new.staff_profile_id
       and ss.service_id       = new.service_id
       and ss.is_active
       and ss.deleted_at is null
       and (ss.branch_id is null or ss.branch_id = v_appointment_branch)
  ) into v_competent;

  if not v_competent then
    raise exception 'Personel bu hizmette yetkin değil (staff_profile_id=%, service_id=%).',
      new.staff_profile_id, new.service_id
      using errcode = 'K0003';
  end if;

  return new;
end $$;

create or replace function resource_bookings_validate_scope() returns trigger
language plpgsql as $$
declare
  v_branch_tenant      uuid;
  v_appointment_tenant uuid;
begin
  select tenant_id into v_branch_tenant from branches where id = new.branch_id;
  if v_branch_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if new.appointment_id is not null then
    select tenant_id into v_appointment_tenant from appointments where id = new.appointment_id;
    if v_appointment_tenant is distinct from new.tenant_id then
      raise exception 'Randevu başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

create or replace function customer_bookings_validate_scope() returns trigger
language plpgsql as $$
declare
  v_customer_tenant    uuid;
  v_appointment_tenant uuid;
begin
  select tenant_id into v_customer_tenant    from customers    where id = new.customer_id;
  select tenant_id into v_appointment_tenant from appointments where id = new.appointment_id;

  if v_customer_tenant is distinct from new.tenant_id
     or v_appointment_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri veya randevu başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- Geçersiz durum geçişi — SON savunma hattı.
create or replace function appointments_enforce_status_transition() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not exists (
      select 1 from appointment_status_transitions t
       where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'Geçersiz randevu durum geçişi: % → %.', old.status, new.status
        using errcode = 'K0001';
    end if;
  end if;
  return new;
end $$;

-- Optimistic locking sayacı. Uygulama `where version = $beklenen` ile yazar;
-- sayacı BURADA artırmak, bir güncelleme yolunun sayacı artırmayı unutup
-- kilidi sessizce etkisiz bırakmasını imkânsız kılar.
create or replace function appointments_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

-- İptal/gelmedi → slot serbest kalır. Satır SİLİNMEZ, `active = false` olur:
-- denetim izi korunur, EXCLUDE constraint kısmi indeks sayesinde onu görmez.
create or replace function appointments_sync_bookings() returns trigger
language plpgsql as $$
begin
  if new.status in ('cancelled', 'no_show') and old.status is distinct from new.status then
    update resource_bookings set active = false
     where appointment_id = new.id and active;
    update customer_bookings set active = false
     where appointment_id = new.id and active;
  end if;
  return new;
end $$;

create trigger appointments_scope_check
  before insert or update of tenant_id, branch_id, customer_id on appointments
  for each row execute function appointments_validate_scope();

create trigger appointments_status_check
  before update on appointments
  for each row execute function appointments_enforce_status_transition();

create trigger appointments_version_bump
  before update on appointments
  for each row execute function appointments_bump_version();

create trigger appointments_sync_bookings_after
  after update of status on appointments
  for each row execute function appointments_sync_bookings();

create trigger appointment_services_scope_check
  before insert or update of tenant_id, appointment_id, service_id, staff_profile_id
  on appointment_services
  for each row execute function appointment_services_validate_scope();

create trigger resource_bookings_scope_check
  before insert or update of tenant_id, branch_id, appointment_id on resource_bookings
  for each row execute function resource_bookings_validate_scope();

create trigger customer_bookings_scope_check
  before insert or update of tenant_id, customer_id, appointment_id on customer_bookings
  for each row execute function customer_bookings_validate_scope();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table appointments enable row level security;
alter table appointments force row level security;
create policy appointments_isolation on appointments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table appointment_services enable row level security;
alter table appointment_services force row level security;
create policy appointment_services_isolation on appointment_services
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table resource_bookings enable row level security;
alter table resource_bookings force row level security;
create policy resource_bookings_isolation on resource_bookings
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table customer_bookings enable row level security;
alter table customer_bookings force row level security;
create policy customer_bookings_isolation on customer_bookings
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- updated_at + denetim
-- ---------------------------------------------------------------------------
create trigger appointments_set_updated_at
  before update on appointments for each row execute function set_updated_at();
create trigger appointment_services_set_updated_at
  before update on appointment_services for each row execute function set_updated_at();
create trigger resource_bookings_set_updated_at
  before update on resource_bookings for each row execute function set_updated_at();
create trigger customer_bookings_set_updated_at
  before update on customer_bookings for each row execute function set_updated_at();

create trigger appointments_audit
  after insert or update or delete on appointments
  for each row execute function audit_row_change('tenant_id');
create trigger appointment_services_audit
  after insert or update or delete on appointment_services
  for each row execute function audit_row_change('tenant_id');
create trigger resource_bookings_audit
  after insert or update or delete on resource_bookings
  for each row execute function audit_row_change('tenant_id');
create trigger customer_bookings_audit
  after insert or update or delete on customer_bookings
  for each row execute function audit_row_change('tenant_id');

-- ---------------------------------------------------------------------------
-- Kiracı ayarları — uygunluk motorunun pencere kuralları (Batch 3.2)
-- ---------------------------------------------------------------------------
alter table tenant_settings
  add column min_lead_minutes integer not null default 0
    check (min_lead_minutes between 0 and 43200),
  add column max_advance_days integer not null default 180
    check (max_advance_days between 1 and 730);

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on appointments, appointment_services, resource_bookings, customer_bookings
  to klinara_app;

-- Durum makinesi sistem sözleşmesidir: uygulama onu OKUR, değiştiremez.
-- Aksi hâlde bir hata izinli geçiş listesini genişleterek kontrolü kendi
-- kendine geçersiz kılabilirdi (aynı gerekçe `roles`/`permissions` için de).
grant select on appointment_status_transitions to klinara_app;
revoke insert, update, delete on appointment_status_transitions from klinara_app;
