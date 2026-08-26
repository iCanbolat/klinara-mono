-- Faz 2.1 — Hizmet kataloğu (staff-only kapsam).

create table service_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  slug        citext      not null,
  name        text        not null check (length(trim(name)) > 0),
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint service_categories_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$')
);

create unique index service_categories_tenant_slug_key
  on service_categories (tenant_id, slug)
  where deleted_at is null;

create index service_categories_tenant_idx
  on service_categories (tenant_id)
  where deleted_at is null;

create table services (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid        not null references tenants(id) on delete cascade,
  category_id           uuid        not null references service_categories(id) on delete restrict,
  slug                  citext      not null,
  name                  text        not null check (length(trim(name)) > 0),
  description           text,
  duration_minutes      integer     not null check (duration_minutes > 0 and duration_minutes <= 1440),
  buffer_before_minutes integer     not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes  integer     not null default 0 check (buffer_after_minutes between 0 and 240),
  price_minor           bigint      not null check (price_minor >= 0),
  vat_rate_basis_points integer     not null default 2000 check (vat_rate_basis_points between 0 and 10000),
  calendar_color        text,
  is_online_bookable    boolean     not null default true,
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint services_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  constraint services_calendar_color_format
    check (calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$')
);

create unique index services_tenant_slug_key
  on services (tenant_id, slug)
  where deleted_at is null;

create index services_tenant_idx
  on services (tenant_id)
  where deleted_at is null;

create index services_category_idx
  on services (category_id)
  where deleted_at is null;

create table branch_service_overrides (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid        not null references tenants(id) on delete cascade,
  branch_id             uuid        not null references branches(id) on delete cascade,
  service_id            uuid        not null references services(id) on delete cascade,
  duration_minutes      integer check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440)),
  buffer_before_minutes integer check (buffer_before_minutes is null or buffer_before_minutes between 0 and 240),
  buffer_after_minutes  integer check (buffer_after_minutes is null or buffer_after_minutes between 0 and 240),
  price_minor           bigint check (price_minor is null or price_minor >= 0),
  vat_rate_basis_points integer check (vat_rate_basis_points is null or vat_rate_basis_points between 0 and 10000),
  is_online_bookable    boolean,
  is_active             boolean,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint branch_service_overrides_any_override
    check (
      duration_minutes is not null
      or buffer_before_minutes is not null
      or buffer_after_minutes is not null
      or price_minor is not null
      or vat_rate_basis_points is not null
      or is_online_bookable is not null
      or is_active is not null
    )
);

create unique index branch_service_overrides_branch_service_key
  on branch_service_overrides (branch_id, service_id)
  where deleted_at is null;

create index branch_service_overrides_tenant_idx
  on branch_service_overrides (tenant_id)
  where deleted_at is null;

create or replace function services_validate_scope() returns trigger
language plpgsql as $$
declare
  v_category_tenant uuid;
begin
  select tenant_id into v_category_tenant from service_categories where id = new.category_id;
  if v_category_tenant is distinct from new.tenant_id then
    raise exception 'Hizmet kategorisi başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function branch_service_overrides_validate_scope() returns trigger
language plpgsql as $$
declare
  v_branch_tenant  uuid;
  v_service_tenant uuid;
begin
  select tenant_id into v_branch_tenant from branches where id = new.branch_id;
  select tenant_id into v_service_tenant from services where id = new.service_id;

  if v_branch_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  if v_service_tenant is distinct from new.tenant_id then
    raise exception 'Hizmet başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger services_scope_check
  before insert or update of tenant_id, category_id on services
  for each row execute function services_validate_scope();

create trigger branch_service_overrides_scope_check
  before insert or update of tenant_id, branch_id, service_id on branch_service_overrides
  for each row execute function branch_service_overrides_validate_scope();

alter table service_categories enable row level security;
alter table service_categories force row level security;
create policy service_categories_isolation on service_categories
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table services enable row level security;
alter table services force row level security;
create policy services_isolation on services
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table branch_service_overrides enable row level security;
alter table branch_service_overrides force row level security;
create policy branch_service_overrides_isolation on branch_service_overrides
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger service_categories_set_updated_at
  before update on service_categories for each row execute function set_updated_at();
create trigger services_set_updated_at
  before update on services for each row execute function set_updated_at();
create trigger branch_service_overrides_set_updated_at
  before update on branch_service_overrides for each row execute function set_updated_at();

create trigger service_categories_audit
  after insert or update or delete on service_categories
  for each row execute function audit_row_change('tenant_id');
create trigger services_audit
  after insert or update or delete on services
  for each row execute function audit_row_change('tenant_id');
create trigger branch_service_overrides_audit
  after insert or update or delete on branch_service_overrides
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete
  on service_categories, services, branch_service_overrides
  to klinara_app;
