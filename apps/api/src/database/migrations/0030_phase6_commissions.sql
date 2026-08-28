-- Batch 6.4 — personel primi.
--
-- Üç karar bu dosyanın tamamını açıklar:
--
-- 1. BELİRSİZLİK YOK. Bir hizmet için birden çok kural eşleşebilir ama
--    UYGULANAN TEK KURAL vardır: en spesifik kapsam, sonra en yüksek öncelik.
--    Eşitlik ihtimali modelden kısmi tekil indeksle KALDIRILIR — "hangi kural
--    uygulandı" sorusu personelle tartışmaya açık olamaz.
--
-- 2. Tahakkuk APPEND-ONLY. Prim bir para taahhüdüdür; iptal, satırı silmekle
--    değil ters kayıtla olur (`package_ledger_entries` ile aynı gerekçe).
--
-- 3. Kapatılmış dönem DONAR. Kapalı dönemi ilgilendiren bir iptal, CARİ AÇIK
--    döneme ters kayıt yazar — geçmişi değiştirmek yerine düzeltmeyi bugüne
--    taşımak muhasebe pratiğidir.

create type commission_scope as enum ('global', 'service', 'package', 'product');

create type commission_calc_kind as enum ('percent', 'fixed');

create type commission_basis as enum
  ('service_price', 'net_after_discount', 'collected_amount');

create type commission_trigger as enum ('service_completed', 'payment_received');

create type commission_period_status as enum ('open', 'closed');

-- ---------------------------------------------------------------------------
-- Kurallar
-- ---------------------------------------------------------------------------
create table commission_rules (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name      text not null check (length(trim(name)) > 0),

  scope        commission_scope not null default 'global',
  -- `service` ise services(id), `package` ise package_definitions(id).
  -- Polimorfik olduğu için FK yok; kapsam doğrulaması trigger'da.
  scope_ref_id uuid,
  -- null = tüm personel. Dolu = yalnız o personel (override).
  staff_profile_id uuid references staff_profiles(id) on delete cascade,

  calc_kind commission_calc_kind not null,
  -- `percent` için BAZ PUAN (1000 = %10), `fixed` için minor unit.
  value     integer not null check (value >= 0),
  basis     commission_basis not null default 'net_after_discount',
  trigger_on commission_trigger not null default 'service_completed',

  priority integer not null default 0,
  effective_from date,
  effective_to   date,
  is_active boolean not null default true,

  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint commission_rules_percent_range
    check (calc_kind <> 'percent' or value <= 10000),
  constraint commission_rules_scope_ref
    check ((scope = 'global') = (scope_ref_id is null)),
  constraint commission_rules_window
    check (effective_from is null or effective_to is null or effective_to >= effective_from),
  -- `collected_amount` matrahı yalnız tahsilat tetikleyicisiyle anlamlıdır:
  -- hizmet tamamlandığında henüz tahsil edilmiş bir tutar yoktur.
  constraint commission_rules_basis_trigger check (
    basis <> 'collected_amount' or trigger_on = 'payment_received'
  )
);

-- BELİRSİZLİĞİ MODELDEN KALDIRAN indeks: aynı kapsam + personel + öncelik ile
-- iki aktif kural olamaz. Çözümleyici bu yüzden daima tek satır bulur.
create unique index commission_rules_resolution_key
  on commission_rules (
    tenant_id, scope, coalesce(scope_ref_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(staff_profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    trigger_on, priority
  )
  where deleted_at is null and is_active;

create index commission_rules_tenant_idx
  on commission_rules (tenant_id, created_at desc, id desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Dönemler
-- ---------------------------------------------------------------------------
create table commission_periods (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete restrict,
  starts_on date not null,
  ends_on   date not null,
  status    commission_period_status not null default 'open',
  closed_by uuid references users(id),
  closed_at timestamptz,
  version   integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_periods_range check (ends_on >= starts_on),
  constraint commission_periods_closed_fields
    check ((status = 'closed') = (closed_at is not null))
);

create unique index commission_periods_key
  on commission_periods (tenant_id, branch_id, starts_on);

create index commission_periods_branch_idx
  on commission_periods (tenant_id, branch_id, starts_on desc);

-- ---------------------------------------------------------------------------
-- Tahakkuklar — APPEND-ONLY
-- ---------------------------------------------------------------------------
create table commission_accruals (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete restrict,
  staff_profile_id uuid not null references staff_profiles(id) on delete restrict,
  period_id uuid not null references commission_periods(id) on delete restrict,

  -- Kuralın SATIŞ ANINDAKİ hâli. Kural sonradan değişse bu tahakkuk kıpırdamaz
  -- — `customer_packages` snapshot'ıyla aynı gerekçe.
  rule_id        uuid references commission_rules(id) on delete set null,
  rule_calc_kind commission_calc_kind not null,
  rule_value     integer not null,
  rule_basis     commission_basis not null,
  trigger_on     commission_trigger not null,

  charge_id  uuid references charges(id) on delete restrict,
  payment_id uuid references payments(id) on delete restrict,

  -- Primin hesaplandığı matrah ve sonuç. İkisi de İŞARETLİ: ters kayıt
  -- negatiftir.
  basis_minor  bigint not null,
  amount_minor bigint not null check (amount_minor <> 0),

  reverses_accrual_id uuid references commission_accruals(id),
  reason        text,
  actor_user_id uuid references users(id),
  created_at    timestamptz not null default now()
);

create index commission_accruals_staff_idx
  on commission_accruals (tenant_id, staff_profile_id, created_at desc, id desc);

create index commission_accruals_period_idx
  on commission_accruals (period_id, staff_profile_id);

create index commission_accruals_charge_idx on commission_accruals (charge_id)
  where charge_id is not null;

create index commission_accruals_payment_idx on commission_accruals (payment_id)
  where payment_id is not null;

-- Bir tahakkuk EN FAZLA BİR KEZ geri alınabilir.
create unique index commission_accruals_reversal_once
  on commission_accruals (reverses_accrual_id)
  where reverses_accrual_id is not null;

-- Aynı ücret kalemi için tamamlama primi İKİ KEZ tahakkuk etmez.
create unique index commission_accruals_charge_once
  on commission_accruals (charge_id, trigger_on)
  where charge_id is not null and reverses_accrual_id is null
    and trigger_on = 'service_completed';

-- Aynı tahsilat + kalem çifti için tahsilat primi İKİ KEZ tahakkuk etmez.
create unique index commission_accruals_payment_once
  on commission_accruals (payment_id, charge_id)
  where payment_id is not null and reverses_accrual_id is null;

-- ---------------------------------------------------------------------------
-- İş kuralları
-- ---------------------------------------------------------------------------
create or replace function commission_accruals_validate() returns trigger
language plpgsql as $$
declare
  v_period commission_periods%rowtype;
  v_original commission_accruals%rowtype;
begin
  select * into v_period from commission_periods where id = new.period_id for update;
  if not found or v_period.tenant_id is distinct from new.tenant_id then
    raise exception 'Prim dönemi başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  -- KAPALI DÖNEM DONAR. Kapalı bir dönemi ilgilendiren düzeltme, çağıran
  -- tarafından CARİ açık döneme yazılır; buradan sessizce geçemez.
  if v_period.status = 'closed' then
    raise exception 'Kapatılmış prim dönemine tahakkuk yazılamaz.' using errcode = 'K0016';
  end if;

  if new.reverses_accrual_id is not null then
    select * into v_original from commission_accruals where id = new.reverses_accrual_id;
    if not found then
      raise exception 'Ters kaydın işaret ettiği tahakkuk yok.' using errcode = 'check_violation';
    end if;
    if v_original.staff_profile_id is distinct from new.staff_profile_id
       or v_original.amount_minor is distinct from -new.amount_minor
    then
      raise exception 'Ters kayıt orijinal tahakkukun tam tersi olmalı.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function commission_rules_validate_scope() returns trigger
language plpgsql as $$
declare
  v_tenant uuid;
begin
  if new.staff_profile_id is not null then
    select tenant_id into v_tenant from staff_profiles where id = new.staff_profile_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Personel başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;

  if new.scope = 'service' and new.scope_ref_id is not null then
    select tenant_id into v_tenant from services where id = new.scope_ref_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Hizmet başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;

  if new.scope = 'package' and new.scope_ref_id is not null then
    select tenant_id into v_tenant from package_definitions where id = new.scope_ref_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Paket tanımı başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function commission_periods_guard_close() returns trigger
language plpgsql as $$
begin
  if old.status = 'closed' then
    raise exception 'Kapatılmış prim dönemi değiştirilemez.' using errcode = 'K0016';
  end if;
  return new;
end $$;

create or replace function commission_rules_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

create or replace function commission_periods_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

create trigger commission_rules_scope_check
  before insert or update on commission_rules
  for each row execute function commission_rules_validate_scope();

create trigger commission_rules_version_bump
  before update on commission_rules
  for each row execute function commission_rules_bump_version();

create trigger commission_periods_close_guard
  before update on commission_periods
  for each row execute function commission_periods_guard_close();

create trigger commission_periods_version_bump
  before update on commission_periods
  for each row execute function commission_periods_bump_version();

create trigger commission_accruals_validate_check
  before insert on commission_accruals
  for each row execute function commission_accruals_validate();

create trigger commission_accruals_immutable
  before update or delete on commission_accruals
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table commission_rules enable row level security;
alter table commission_rules force row level security;
create policy commission_rules_isolation on commission_rules
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table commission_periods enable row level security;
alter table commission_periods force row level security;
create policy commission_periods_isolation on commission_periods
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table commission_accruals enable row level security;
alter table commission_accruals force row level security;
create policy commission_accruals_isolation on commission_accruals
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger commission_rules_set_updated_at
  before update on commission_rules for each row execute function set_updated_at();

create trigger commission_periods_set_updated_at
  before update on commission_periods for each row execute function set_updated_at();

create trigger commission_rules_audit
  after insert or update or delete on commission_rules
  for each row execute function audit_row_change('tenant_id');

create trigger commission_periods_audit
  after insert or update or delete on commission_periods
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update on commission_rules to klinara_app;
revoke delete on commission_rules from klinara_app;
grant select, insert, update on commission_periods to klinara_app;
revoke delete on commission_periods from klinara_app;
grant select, insert on commission_accruals to klinara_app;
revoke update, delete on commission_accruals from klinara_app;

-- ---------------------------------------------------------------------------
-- 6.4 izinleri
-- ---------------------------------------------------------------------------
-- `finance.commission:read` YALNIZ okuma sözleşmesidir ve muhasebede zaten
-- var; kural yazmak ve dönem kapatmak ayrı bir yetkidir. Muhasebe primi
-- GÖRÜR ama kuralını değiştiremez.
insert into permissions (key, description) values
  ('finance.commission:write', 'Prim kurallarını yazma ve dönem kapatma')
on conflict (key) do update set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',   'finance.commission:write'),
  ('manager', 'finance.commission:write')
on conflict do nothing;
