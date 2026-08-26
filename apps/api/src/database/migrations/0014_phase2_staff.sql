-- Faz 2.2 — Personel profili ve hizmet yetkinlik matrisi.

create table staff_profiles (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid        not null references tenants(id) on delete cascade,
  user_id           uuid        not null references users(id) on delete cascade,
  primary_branch_id uuid references branches(id) on delete set null,
  title             text,
  specialties       text[]      not null default '{}',
  calendar_color    text,
  bio               text,
  is_visible_online boolean     not null default true,
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint staff_profiles_calendar_color_format
    check (calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$')
);

create unique index staff_profiles_tenant_user_key
  on staff_profiles (tenant_id, user_id)
  where deleted_at is null;

create index staff_profiles_tenant_idx
  on staff_profiles (tenant_id)
  where deleted_at is null;

create table staff_services (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid        not null references tenants(id) on delete cascade,
  staff_profile_id        uuid        not null references staff_profiles(id) on delete cascade,
  service_id              uuid        not null references services(id) on delete cascade,
  branch_id               uuid references branches(id) on delete cascade,
  custom_duration_minutes integer check (custom_duration_minutes is null or (custom_duration_minutes > 0 and custom_duration_minutes <= 1440)),
  custom_price_minor      bigint check (custom_price_minor is null or custom_price_minor >= 0),
  is_active               boolean     not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  constraint staff_services_unique unique nulls not distinct (tenant_id, staff_profile_id, service_id, branch_id)
);

create index staff_services_tenant_idx
  on staff_services (tenant_id)
  where deleted_at is null;

create index staff_services_profile_idx
  on staff_services (staff_profile_id)
  where deleted_at is null;

create or replace function staff_profiles_validate_scope() returns trigger
language plpgsql as $$
declare
  v_branch_tenant uuid;
  v_membership_exists boolean;
begin
  if new.primary_branch_id is not null then
    select tenant_id into v_branch_tenant from branches where id = new.primary_branch_id;
    if v_branch_tenant is distinct from new.tenant_id then
      raise exception 'Personelin birincil şubesi başka bir kiracıya ait.'
        using errcode = 'check_violation';
    end if;
  end if;

  select exists(
    select 1
      from memberships
     where user_id = new.user_id
       and tenant_id = new.tenant_id
       and is_active = true
       and deleted_at is null
  ) into v_membership_exists;

  if not v_membership_exists then
    raise exception 'Personel profili açılacak kullanıcı bu kiracının üyesi değil.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create or replace function staff_services_validate_scope() returns trigger
language plpgsql as $$
declare
  v_profile_tenant uuid;
  v_service_tenant uuid;
  v_branch_tenant  uuid;
begin
  select tenant_id into v_profile_tenant from staff_profiles where id = new.staff_profile_id;
  select tenant_id into v_service_tenant from services where id = new.service_id;

  if v_profile_tenant is distinct from new.tenant_id then
    raise exception 'Personel profili başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  if v_service_tenant is distinct from new.tenant_id then
    raise exception 'Hizmet başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  if new.branch_id is not null then
    select tenant_id into v_branch_tenant from branches where id = new.branch_id;
    if v_branch_tenant is distinct from new.tenant_id then
      raise exception 'Şube başka bir kiracıya ait.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

create trigger staff_profiles_scope_check
  before insert or update of tenant_id, user_id, primary_branch_id on staff_profiles
  for each row execute function staff_profiles_validate_scope();

create trigger staff_services_scope_check
  before insert or update of tenant_id, staff_profile_id, service_id, branch_id on staff_services
  for each row execute function staff_services_validate_scope();

alter table staff_profiles enable row level security;
alter table staff_profiles force row level security;
create policy staff_profiles_isolation on staff_profiles
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table staff_services enable row level security;
alter table staff_services force row level security;
create policy staff_services_isolation on staff_services
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger staff_profiles_set_updated_at
  before update on staff_profiles for each row execute function set_updated_at();
create trigger staff_services_set_updated_at
  before update on staff_services for each row execute function set_updated_at();

create trigger staff_profiles_audit
  after insert or update or delete on staff_profiles
  for each row execute function audit_row_change('tenant_id');
create trigger staff_services_audit
  after insert or update or delete on staff_services
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on staff_profiles, staff_services to klinara_app;
