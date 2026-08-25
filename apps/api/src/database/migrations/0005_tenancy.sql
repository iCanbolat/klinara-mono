-- Kiracılık çekirdeği: tenants → branches (+ ayarlar).

create type tenant_status as enum ('trial', 'active', 'suspended');

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  -- Online randevu sayfasının subdomain'i: {slug}.klinara.app
  slug        citext        not null unique,
  name        text          not null check (length(trim(name)) > 0),
  status      tenant_status not null default 'trial',
  timezone    text          not null default 'Europe/Istanbul',
  currency    char(3)       not null default 'TRY',
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  deleted_at  timestamptz,
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  constraint tenants_slug_not_reserved check (
    slug not in ('www', 'api', 'admin', 'app', 'docs', 'mail', 'static', 'assets',
                 'status', 'help', 'support', 'blog', 'klinara')
  )
);

create table branches (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  slug        citext      not null,
  name        text        not null check (length(trim(name)) > 0),
  -- Her şubenin kendi saat dilimi olabilir; slot üretimi bu değere göre yapılır.
  timezone    text        not null default 'Europe/Istanbul',
  phone       text,
  address     text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (tenant_id, slug)
);

create index branches_tenant_idx on branches (tenant_id) where deleted_at is null;

create table tenant_settings (
  tenant_id                       uuid        primary key references tenants(id) on delete cascade,
  -- Takvimde slot ızgarasının adımı (dakika).
  slot_granularity_minutes        integer     not null default 15
    check (slot_granularity_minutes in (5, 10, 15, 20, 30, 60)),
  -- Açıkken aynı müşterinin çakışan iki randevusu DB seviyesinde engellenir
  -- (bkz. customer_bookings, Batch 3.1).
  prevent_customer_double_booking boolean     not null default true,
  -- Hatırlatmanın randevudan kaç saat önce gönderileceği.
  reminder_hours_before           integer[]   not null default '{24,2}',
  -- Online randevu iptal penceresi (saat).
  cancel_window_hours             integer     not null default 24,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- `force` şart: onsuz tablo SAHİBİ politikaları atlar ve testler yanlış
-- yere güven verir.

alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenants_isolation on tenants
  using (
    id = current_tenant_id()
    or current_setting('app.platform_admin', true) = 'on'
  )
  with check (
    id = current_tenant_id()
    or current_setting('app.platform_admin', true) = 'on'
  );

alter table branches enable row level security;
alter table branches force row level security;
create policy branches_isolation on branches
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table tenant_settings enable row level security;
alter table tenant_settings force row level security;
create policy tenant_settings_isolation on tenant_settings
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Trigger'lar
-- ---------------------------------------------------------------------------
create trigger tenants_set_updated_at
  before update on tenants for each row execute function set_updated_at();
create trigger branches_set_updated_at
  before update on branches for each row execute function set_updated_at();
create trigger tenant_settings_set_updated_at
  before update on tenant_settings for each row execute function set_updated_at();

-- `tenants` tablosunda kiracı kimliği 'id' kolonundadır.
create trigger tenants_audit
  after insert or update or delete on tenants
  for each row execute function audit_row_change('id');
create trigger branches_audit
  after insert or update or delete on branches
  for each row execute function audit_row_change('tenant_id');
create trigger tenant_settings_audit
  after insert or update or delete on tenant_settings
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on tenants, branches, tenant_settings to klinara_app;
grant select on audit_log to klinara_app;
grant usage, select on sequence audit_log_id_seq to klinara_app;
