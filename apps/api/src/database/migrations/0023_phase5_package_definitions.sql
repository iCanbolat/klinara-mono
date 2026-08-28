-- Batch 5.1 — paket tanımları.
--
-- Tanım bir ŞABLONDUR; satılan paket onun satış anındaki KOPYASIDIR (0024).
-- Bu ayrım "fiyat değişince eski satışlar etkilenmez" kriterinin tamamıdır:
-- ayrı bir sürüm tablosu tutmuyoruz, snapshot'ın kendisi sürümdür.

create table package_definitions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  -- null = tüm şubelerde satılır. Dolu = yalnız o şubede.
  branch_id          uuid references branches(id) on delete restrict,
  slug               citext not null,
  name               text not null check (length(trim(name)) > 0),
  description        text,
  total_price_minor  bigint not null check (total_price_minor >= 0),
  currency           char(3) not null default 'TRY',
  validity_days      integer check (validity_days is null or validity_days between 1 and 3650),
  is_transferable    boolean not null default true,
  is_online_sellable boolean not null default false,
  is_active          boolean not null default true,
  -- Fiyat ya da kalem değişince artar; satış bunu kopyalar, böylece
  -- "bu paket kaçıncı revizyondan satıldı" sorusu cevaplanabilir.
  revision           integer not null default 1,
  -- Optimistic locking (5.7). Sayaç trigger'da artar, uygulamada değil.
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create unique index package_definitions_tenant_slug_key
  on package_definitions (tenant_id, slug)
  where deleted_at is null;

create index package_definitions_tenant_idx
  on package_definitions (tenant_id, created_at desc, id desc)
  where deleted_at is null;

create table package_definition_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  definition_id uuid not null references package_definitions(id) on delete cascade,
  service_id    uuid not null references services(id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index package_definition_items_service_key
  on package_definition_items (definition_id, service_id);

create index package_definition_items_definition_idx
  on package_definition_items (definition_id, sort_order, id);

-- ---------------------------------------------------------------------------
-- Kapsam doğrulaması — FK doğrulaması RLS'i bypass eder.
-- ---------------------------------------------------------------------------
create or replace function package_definitions_validate_scope() returns trigger
language plpgsql as $$
declare
  v_branch_tenant uuid;
begin
  if new.branch_id is not null then
    select tenant_id into v_branch_tenant from branches where id = new.branch_id;
    if v_branch_tenant is distinct from new.tenant_id then
      raise exception 'Şube başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function package_definition_items_validate_scope() returns trigger
language plpgsql as $$
declare
  v_definition_tenant uuid;
  v_service_tenant    uuid;
  v_service_active    boolean;
  v_service_deleted   timestamptz;
begin
  select tenant_id into v_definition_tenant
    from package_definitions where id = new.definition_id;
  if v_definition_tenant is distinct from new.tenant_id then
    raise exception 'Paket tanımı başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  select tenant_id, is_active, deleted_at
    into v_service_tenant, v_service_active, v_service_deleted
    from services where id = new.service_id;
  if v_service_tenant is distinct from new.tenant_id then
    raise exception 'Hizmet başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;
  if v_service_deleted is not null or not v_service_active then
    raise exception 'Pasif hizmet pakete eklenemez.' using errcode = 'K0002';
  end if;
  return new;
end $$;

create or replace function package_definitions_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  -- Revizyon YALNIZ satışı etkileyen alanlar değişince artar; ad ya da
  -- açıklama düzeltmesi yeni bir revizyon değildir.
  if new.total_price_minor is distinct from old.total_price_minor
     or new.validity_days is distinct from old.validity_days
     or new.is_transferable is distinct from old.is_transferable
  then
    new.revision := old.revision + 1;
  end if;
  return new;
end $$;

create trigger package_definitions_scope_check
  before insert or update of tenant_id, branch_id on package_definitions
  for each row execute function package_definitions_validate_scope();

create trigger package_definitions_version_bump
  before update on package_definitions
  for each row execute function package_definitions_bump_version();

create trigger package_definition_items_scope_check
  before insert or update on package_definition_items
  for each row execute function package_definition_items_validate_scope();

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table package_definitions enable row level security;
alter table package_definitions force row level security;
create policy package_definitions_isolation on package_definitions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table package_definition_items enable row level security;
alter table package_definition_items force row level security;
create policy package_definition_items_isolation on package_definition_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger package_definitions_set_updated_at
  before update on package_definitions for each row execute function set_updated_at();

create trigger package_definition_items_set_updated_at
  before update on package_definition_items for each row execute function set_updated_at();

create trigger package_definitions_audit
  after insert or update or delete on package_definitions
  for each row execute function audit_row_change('tenant_id');

create trigger package_definition_items_audit
  after insert or update or delete on package_definition_items
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on package_definitions to klinara_app;
grant select, insert, update, delete on package_definition_items to klinara_app;
