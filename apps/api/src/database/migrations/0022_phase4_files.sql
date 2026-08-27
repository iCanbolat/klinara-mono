-- Batch 4.3 — müşteri dosyaları, öncesi/sonrası fotoğraf eşlemesi ve
-- özel nitelikli veri erişim kaydı.

create type customer_file_kind as enum ('photo', 'document');
create type customer_file_position as enum ('before', 'after', 'other');
create type customer_file_status as enum ('pending', 'ready');

-- Öncesi/sonrası eşlemesi bir GRUP altında kurulur: "sağ kol, 3. seans" gibi.
create table customer_file_groups (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  body_area   text,
  service_id  uuid references services(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index customer_file_groups_customer_idx
  on customer_file_groups (tenant_id, customer_id, created_at desc);

create table customer_files (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  customer_id   uuid not null references customers(id) on delete cascade,
  group_id      uuid references customer_file_groups(id) on delete set null,
  kind          customer_file_kind not null,
  position      customer_file_position not null default 'other',
  -- Nesne anahtarı. İÇERİK asla veritabanında durmaz.
  storage_key   text not null unique,
  thumbnail_key text,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  -- İstemcinin bildirdiği içerik hash'i; `confirm` adımında doğrulanır.
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  status        customer_file_status not null default 'ready',
  taken_at      timestamptz,
  uploaded_by   uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index customer_files_customer_idx
  on customer_files (tenant_id, customer_id, created_at desc)
  where deleted_at is null;

create index customer_files_group_idx
  on customer_files (group_id)
  where group_id is not null and deleted_at is null;

-- FK doğrulaması RLS'i bypass eder.
create or replace function customer_files_validate_scope() returns trigger
language plpgsql as $$
declare
  v_customer_tenant uuid;
  v_group_tenant    uuid;
begin
  select tenant_id into v_customer_tenant from customers where id = new.customer_id;
  if v_customer_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if new.group_id is not null then
    select tenant_id into v_group_tenant from customer_file_groups where id = new.group_id;
    if v_group_tenant is distinct from new.tenant_id then
      raise exception 'Dosya grubu başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger customer_files_scope_check
  before insert or update on customer_files
  for each row execute function customer_files_validate_scope();

-- ---------------------------------------------------------------------------
-- Özel nitelikli veri erişim kaydı (KVKK m.6)
-- ---------------------------------------------------------------------------
-- "Kim, ne zaman, hangi IP'den görüntüledi?" — bu bir özellik değil,
-- YÜKÜMLÜLÜK (bkz. bölüm 4.5). Bu yüzden append-only.
create type record_access_resource as enum ('file', 'note');
create type record_access_action   as enum ('view', 'download');

create table customer_record_access_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  customer_id   uuid not null references customers(id) on delete cascade,
  actor_user_id uuid references users(id),
  resource_type record_access_resource not null,
  resource_id   uuid,
  action        record_access_action not null,
  ip            inet,
  user_agent    text,
  request_id    text,
  created_at    timestamptz not null default now()
);

create index customer_record_access_log_customer_idx
  on customer_record_access_log (tenant_id, customer_id, created_at desc);

create trigger customer_record_access_log_immutable
  before update or delete on customer_record_access_log
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table customer_file_groups enable row level security;
alter table customer_file_groups force row level security;
create policy customer_file_groups_isolation on customer_file_groups
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table customer_files enable row level security;
alter table customer_files force row level security;
create policy customer_files_isolation on customer_files
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table customer_record_access_log enable row level security;
alter table customer_record_access_log force row level security;
create policy customer_record_access_log_isolation on customer_record_access_log
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger customer_file_groups_set_updated_at
  before update on customer_file_groups for each row execute function set_updated_at();

create trigger customer_files_set_updated_at
  before update on customer_files for each row execute function set_updated_at();

create trigger customer_files_audit
  after insert or update or delete on customer_files
  for each row execute function audit_row_change('tenant_id');

-- Erişim kaydına denetim trigger'ı YOK: kendisi zaten bir denetim kaydı,
-- her satırını audit_log'a kopyalamak yalnız yer harcardı.

grant select, insert, update, delete on customer_file_groups to klinara_app;
grant select, insert, update, delete on customer_files to klinara_app;
grant select, insert on customer_record_access_log to klinara_app;
revoke update, delete on customer_record_access_log from klinara_app;
