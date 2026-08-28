-- Batch 6.3 — kasa oturumu, kasa hareketleri ve iade.
--
-- Buranın işi PARANIN FİİLEN HAREKET ETMESİ. 0027 borcun doğduğunu, 0028
-- paranın girdiğini kaydetti; kasa ise günün sonunda "çekmecede ne olması
-- gerekiyordu, ne vardı" sorusunu cevaplar.
--
-- Faz 5'ten devreden açık madde burada kapanır: paket iadesi 5.3'te
-- `refund_settlement_status = 'pending'` yazıp duruyordu; 0027 negatif borç
-- kalemini doğurdu, burada para çıkışı yapılıp durum `settled`'a çekiliyor.

create type cash_movement_kind as enum
  ('opening', 'payment', 'refund', 'payout', 'deposit');

create type refund_kind as enum ('package', 'service', 'other');

-- ---------------------------------------------------------------------------
-- Kasa oturumu
-- ---------------------------------------------------------------------------
create table cash_register_sessions (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete restrict,

  opened_by uuid references users(id),
  opened_at timestamptz not null default now(),
  opening_balance_minor bigint not null default 0 check (opening_balance_minor >= 0),

  closed_by uuid references users(id),
  closed_at timestamptz,
  -- Kapanışta HESAPLANIP yazılır (açılış + oturumdaki nakit hareketler).
  -- Saklanan bir sayaç değil, kapanış anının fotoğrafıdır.
  expected_minor   bigint,
  counted_minor    bigint,
  difference_minor bigint,
  difference_reason text,

  currency   char(3) not null default 'TRY',
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cash_sessions_status_fields check (
    (closed_at is null) = (counted_minor is null)
    and (closed_at is null) = (expected_minor is null)
    and (closed_at is null) = (difference_minor is null)
  ),
  -- Fark varsa gerekçe ZORUNLU. Gerekçesiz bir fark, denetimde "para nereye
  -- gitti" sorusunun cevapsız kalması demekti.
  constraint cash_sessions_difference_reason check (
    difference_minor is null
    or difference_minor = 0
    or length(trim(coalesce(difference_reason, ''))) >= 5
  ),
  constraint cash_sessions_difference_math check (
    difference_minor is null or difference_minor = counted_minor - expected_minor
  )
);

-- Durum kolonu YOK: açıklık `closed_at is null` ile TÜRETİLİR. Ayrı bir
-- kolon, `closed_at` ile senkron tutulması gereken ikinci bir gerçek olurdu.
create unique index cash_sessions_single_open_key
  on cash_register_sessions (tenant_id, branch_id)
  where closed_at is null;

create index cash_sessions_branch_idx
  on cash_register_sessions (tenant_id, branch_id, opened_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Kasa hareketleri — APPEND-ONLY
-- ---------------------------------------------------------------------------
create table cash_movements (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  session_id uuid not null references cash_register_sessions(id) on delete restrict,
  kind       cash_movement_kind not null,
  -- İŞARETLİ: giriş pozitif, çıkış negatif. Beklenen tutar bunların
  -- toplamıdır, tür bazlı ayrı sayaçlar tutulmaz.
  amount_minor bigint not null check (amount_minor <> 0),
  payment_id uuid references payments(id) on delete restrict,
  refund_id  uuid,
  note       text,
  actor_user_id uuid references users(id),
  created_at timestamptz not null default now(),

  constraint cash_movements_sign check (
    (kind in ('opening', 'payment', 'deposit') and amount_minor > 0)
    or (kind in ('refund', 'payout') and amount_minor < 0)
  )
);

create index cash_movements_session_idx on cash_movements (session_id, created_at, id);
create index cash_movements_payment_idx on cash_movements (payment_id)
  where payment_id is not null;

-- Bir tahsilat kasaya EN FAZLA BİR KEZ girer.
create unique index cash_movements_payment_once
  on cash_movements (payment_id)
  where payment_id is not null;

-- ---------------------------------------------------------------------------
-- İade
-- ---------------------------------------------------------------------------
create table refunds (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,

  kind         refund_kind not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency     char(3) not null default 'TRY',
  method       payment_method not null,

  -- Paket iadesinde 0027'nin ürettiği NEGATİF ücret kalemi; hizmet iadesinde
  -- iade edilen kalem.
  charge_id uuid references charges(id) on delete restrict,
  customer_package_id uuid references customer_packages(id) on delete restrict,
  cash_session_id uuid references cash_register_sessions(id) on delete restrict,

  reason      text not null check (length(trim(reason)) >= 5),
  refunded_by uuid references users(id),
  refunded_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index refunds_customer_idx on refunds (tenant_id, customer_id, refunded_at desc, id desc);
create index refunds_package_idx on refunds (customer_package_id)
  where customer_package_id is not null;

-- Bir negatif ücret kalemi EN FAZLA BİR KEZ iade edilir.
create unique index refunds_charge_once
  on refunds (charge_id)
  where charge_id is not null;

-- ---------------------------------------------------------------------------
-- Nakit tahsilat açık kasa oturumuna BAĞLI olmak zorundadır
-- ---------------------------------------------------------------------------
-- Kural burada, serviste değil: aksi hâlde "kasa dışı nakit" sessizce
-- birikirdi ve gün sonu farkının nereden geldiği hiç bulunamazdı.
alter table payments
  add constraint payments_cash_session_fk
  foreign key (cash_session_id) references cash_register_sessions(id) on delete restrict;

create or replace function payments_validate_cash_session() returns trigger
language plpgsql as $$
declare
  v_session cash_register_sessions%rowtype;
begin
  if new.method <> 'cash' then
    if new.cash_session_id is not null then
      raise exception 'Nakit olmayan tahsilat kasa oturumuna bağlanamaz.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.cash_session_id is null then
    raise exception 'Nakit tahsilat için açık bir kasa oturumu gerekli.'
      using errcode = 'K0014';
  end if;

  select * into v_session from cash_register_sessions
   where id = new.cash_session_id for update;

  if not found or v_session.tenant_id is distinct from new.tenant_id then
    raise exception 'Kasa oturumu başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;
  if v_session.branch_id is distinct from new.branch_id then
    raise exception 'Kasa oturumu başka bir şubeye ait.' using errcode = 'K0014';
  end if;
  if v_session.closed_at is not null then
    raise exception 'Kapanmış kasa oturumuna hareket yazılamaz.' using errcode = 'K0015';
  end if;
  return new;
end $$;

create trigger payments_cash_session_check
  before insert on payments
  for each row execute function payments_validate_cash_session();

create or replace function cash_movements_validate() returns trigger
language plpgsql as $$
declare
  v_session cash_register_sessions%rowtype;
begin
  select * into v_session from cash_register_sessions
   where id = new.session_id for update;

  if not found or v_session.tenant_id is distinct from new.tenant_id then
    raise exception 'Kasa oturumu başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;
  -- Açılış hareketi oturumla BİRLİKTE yazılır; kapanış kontrolü ondan sonra
  -- anlamlıdır.
  if v_session.closed_at is not null then
    raise exception 'Kapanmış kasa oturumuna hareket yazılamaz.' using errcode = 'K0015';
  end if;
  return new;
end $$;

create trigger cash_movements_validate_check
  before insert on cash_movements
  for each row execute function cash_movements_validate();

create trigger cash_movements_immutable
  before update or delete on cash_movements
  for each row execute function reject_mutation();

-- Kapatılmış oturum DONAR: yeniden açmak, gün sonu sayımını geçersiz kılardı.
create or replace function cash_sessions_guard_close() returns trigger
language plpgsql as $$
begin
  if old.closed_at is not null then
    raise exception 'Kapanmış kasa oturumu değiştirilemez.' using errcode = 'K0015';
  end if;
  return new;
end $$;

create or replace function cash_sessions_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

create trigger cash_sessions_close_guard
  before update on cash_register_sessions
  for each row execute function cash_sessions_guard_close();

create trigger cash_sessions_version_bump
  before update on cash_register_sessions
  for each row execute function cash_sessions_bump_version();

create or replace function refunds_validate_scope() returns trigger
language plpgsql as $$
declare
  v_tenant uuid;
  v_charge charges%rowtype;
begin
  select tenant_id into v_tenant from customers where id = new.customer_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if new.charge_id is not null then
    select * into v_charge from charges where id = new.charge_id for update;
    if not found or v_charge.tenant_id is distinct from new.tenant_id then
      raise exception 'Ücret kalemi başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
    if v_charge.customer_id is distinct from new.customer_id then
      raise exception 'İade kalemi müşteriyle uyuşmuyor.' using errcode = 'K0009';
    end if;
    -- İade EDİLEN tutar, negatif kalemin tutarını aşamaz.
    if new.amount_minor > abs(v_charge.total_minor) then
      raise exception 'İade tutarı (%) kalemin tutarını (%) aşıyor.',
        new.amount_minor, abs(v_charge.total_minor) using errcode = 'K0013';
    end if;
  end if;

  if new.method = 'cash' then
    if new.cash_session_id is null then
      raise exception 'Nakit iade için açık bir kasa oturumu gerekli.' using errcode = 'K0014';
    end if;
    perform 1 from cash_register_sessions
     where id = new.cash_session_id and tenant_id = new.tenant_id and closed_at is null;
    if not found then
      raise exception 'Kasa oturumu açık değil.' using errcode = 'K0015';
    end if;
  end if;
  return new;
end $$;

create trigger refunds_scope_check
  before insert on refunds
  for each row execute function refunds_validate_scope();

create trigger refunds_immutable
  before update or delete on refunds
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table cash_register_sessions enable row level security;
alter table cash_register_sessions force row level security;
create policy cash_sessions_isolation on cash_register_sessions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table cash_movements enable row level security;
alter table cash_movements force row level security;
create policy cash_movements_isolation on cash_movements
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table refunds enable row level security;
alter table refunds force row level security;
create policy refunds_isolation on refunds
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger cash_sessions_set_updated_at
  before update on cash_register_sessions for each row execute function set_updated_at();

create trigger cash_sessions_audit
  after insert or update or delete on cash_register_sessions
  for each row execute function audit_row_change('tenant_id');

create trigger refunds_audit
  after insert or update or delete on refunds
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update on cash_register_sessions to klinara_app;
revoke delete on cash_register_sessions from klinara_app;
grant select, insert on cash_movements to klinara_app;
revoke update, delete on cash_movements from klinara_app;
grant select, insert on refunds to klinara_app;
revoke update, delete on refunds from klinara_app;
