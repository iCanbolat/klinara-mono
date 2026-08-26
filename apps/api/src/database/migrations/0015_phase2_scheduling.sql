-- Faz 2.3 — Şube/personel çalışma saatleri ve istisnalar (weekly recurrence dahil).

create type schedule_recurrence_type as enum ('none', 'weekly');

create table branch_hours (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid        not null references tenants(id) on delete cascade,
  branch_id        uuid        not null references branches(id) on delete cascade,
  day_of_week      integer     not null check (day_of_week between 0 and 6),
  is_closed        boolean     not null default false,
  open_time        time,
  close_time       time,
  break_start_time time,
  break_end_time   time,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint branch_hours_time_window
    check (
      (
        is_closed
        and open_time is null
        and close_time is null
        and break_start_time is null
        and break_end_time is null
      )
      or
      (
        not is_closed
        and open_time is not null
        and close_time is not null
        and open_time < close_time
        and (
          (break_start_time is null and break_end_time is null)
          or
          (
            break_start_time is not null
            and break_end_time is not null
            and open_time <= break_start_time
            and break_start_time < break_end_time
            and break_end_time <= close_time
          )
        )
      )
    )
);

create unique index branch_hours_branch_day_key
  on branch_hours (branch_id, day_of_week)
  where deleted_at is null;

create table staff_schedules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid        not null references tenants(id) on delete cascade,
  staff_profile_id uuid        not null references staff_profiles(id) on delete cascade,
  branch_id        uuid        not null references branches(id) on delete cascade,
  day_of_week      integer     not null check (day_of_week between 0 and 6),
  is_off           boolean     not null default false,
  start_time       time,
  end_time         time,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint staff_schedules_time_window
    check (
      (
        is_off
        and start_time is null
        and end_time is null
      )
      or
      (
        not is_off
        and start_time is not null
        and end_time is not null
        and start_time < end_time
      )
    )
);

create unique index staff_schedules_profile_branch_day_key
  on staff_schedules (staff_profile_id, branch_id, day_of_week)
  where deleted_at is null;

create index staff_schedules_tenant_idx
  on staff_schedules (tenant_id)
  where deleted_at is null;

create table schedule_exceptions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid        not null references tenants(id) on delete cascade,
  staff_profile_id          uuid        not null references staff_profiles(id) on delete cascade,
  branch_id                 uuid        not null references branches(id) on delete cascade,
  starts_at                 timestamptz not null,
  ends_at                   timestamptz not null,
  reason                    text,
  recurrence_type           schedule_recurrence_type not null default 'none',
  recurrence_interval_weeks integer     not null default 1 check (recurrence_interval_weeks between 1 and 52),
  recurrence_until          timestamptz,
  recurrence_weekdays       integer[]   not null default '{}',
  is_active                 boolean     not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  constraint schedule_exceptions_time_order check (ends_at > starts_at),
  constraint schedule_exceptions_recurrence check (
    (
      recurrence_type = 'none'
      and recurrence_until is null
      and cardinality(recurrence_weekdays) = 0
      and recurrence_interval_weeks = 1
    )
    or
    (
      recurrence_type = 'weekly'
      and recurrence_until is not null
      and recurrence_until > starts_at
      and cardinality(recurrence_weekdays) > 0
      and recurrence_weekdays <@ array[0,1,2,3,4,5,6]::integer[]
    )
  )
);

create index schedule_exceptions_tenant_idx
  on schedule_exceptions (tenant_id, starts_at)
  where deleted_at is null;

create index schedule_exceptions_staff_idx
  on schedule_exceptions (staff_profile_id, starts_at)
  where deleted_at is null;

create table holidays (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  branch_id   uuid references branches(id) on delete cascade,
  holiday_date date       not null,
  name        text        not null check (length(trim(name)) > 0),
  is_closed   boolean     not null default true,
  open_time   time,
  close_time  time,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint holidays_time_window check (
    (
      is_closed
      and open_time is null
      and close_time is null
    )
    or
    (
      not is_closed
      and open_time is not null
      and close_time is not null
      and open_time < close_time
    )
  )
);

create unique index holidays_tenant_branch_date_key
  on holidays (tenant_id, branch_id, holiday_date)
  where deleted_at is null;

create or replace function branch_hours_validate_scope() returns trigger
language plpgsql as $$
declare
  v_branch_tenant uuid;
begin
  select tenant_id into v_branch_tenant from branches where id = new.branch_id;
  if v_branch_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function staff_schedules_validate_scope() returns trigger
language plpgsql as $$
declare
  v_profile_tenant uuid;
  v_branch_tenant  uuid;
begin
  select tenant_id into v_profile_tenant from staff_profiles where id = new.staff_profile_id;
  select tenant_id into v_branch_tenant from branches where id = new.branch_id;

  if v_profile_tenant is distinct from new.tenant_id then
    raise exception 'Personel profili başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  if v_branch_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create or replace function schedule_exceptions_validate_scope() returns trigger
language plpgsql as $$
declare
  v_profile_tenant uuid;
  v_branch_tenant  uuid;
begin
  select tenant_id into v_profile_tenant from staff_profiles where id = new.staff_profile_id;
  select tenant_id into v_branch_tenant from branches where id = new.branch_id;

  if v_profile_tenant is distinct from new.tenant_id then
    raise exception 'Personel profili başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  if v_branch_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create or replace function holidays_validate_scope() returns trigger
language plpgsql as $$
declare
  v_branch_tenant uuid;
begin
  if new.branch_id is not null then
    select tenant_id into v_branch_tenant from branches where id = new.branch_id;
    if v_branch_tenant is distinct from new.tenant_id then
      raise exception 'Şube başka bir kiracıya ait.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger branch_hours_scope_check
  before insert or update of tenant_id, branch_id on branch_hours
  for each row execute function branch_hours_validate_scope();

create trigger staff_schedules_scope_check
  before insert or update of tenant_id, staff_profile_id, branch_id on staff_schedules
  for each row execute function staff_schedules_validate_scope();

create trigger schedule_exceptions_scope_check
  before insert or update of tenant_id, staff_profile_id, branch_id on schedule_exceptions
  for each row execute function schedule_exceptions_validate_scope();

create trigger holidays_scope_check
  before insert or update of tenant_id, branch_id on holidays
  for each row execute function holidays_validate_scope();

alter table branch_hours enable row level security;
alter table branch_hours force row level security;
create policy branch_hours_isolation on branch_hours
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table staff_schedules enable row level security;
alter table staff_schedules force row level security;
create policy staff_schedules_isolation on staff_schedules
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table schedule_exceptions enable row level security;
alter table schedule_exceptions force row level security;
create policy schedule_exceptions_isolation on schedule_exceptions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table holidays enable row level security;
alter table holidays force row level security;
create policy holidays_isolation on holidays
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger branch_hours_set_updated_at
  before update on branch_hours for each row execute function set_updated_at();
create trigger staff_schedules_set_updated_at
  before update on staff_schedules for each row execute function set_updated_at();
create trigger schedule_exceptions_set_updated_at
  before update on schedule_exceptions for each row execute function set_updated_at();
create trigger holidays_set_updated_at
  before update on holidays for each row execute function set_updated_at();

create trigger branch_hours_audit
  after insert or update or delete on branch_hours
  for each row execute function audit_row_change('tenant_id');
create trigger staff_schedules_audit
  after insert or update or delete on staff_schedules
  for each row execute function audit_row_change('tenant_id');
create trigger schedule_exceptions_audit
  after insert or update or delete on schedule_exceptions
  for each row execute function audit_row_change('tenant_id');
create trigger holidays_audit
  after insert or update or delete on holidays
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete
  on branch_hours, staff_schedules, schedule_exceptions, holidays
  to klinara_app;
