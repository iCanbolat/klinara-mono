-- Batch 6.2 — tahsilat ve dağıtım.
--
-- KAPSAM NOTU: taksitli tahsilat ve online ödeme sağlayıcısı bu fazda YOK
-- (v2'ye bırakıldı). `payment_plans`, `payment_plan_installments` ve
-- `payment_provider_transactions` tabloları KURULMAZ. Kısmi tahsilat
-- DAĞITIMI ise burada: bir tahsilatın birden çok ücret kalemine bölünmesi
-- taksit değil, kasadaki günlük gerçektir ve cari bakiyenin doğru çıkması
-- buna bağlıdır.
--
-- Defter felsefesi 0024 ile aynı: `payment_allocations` APPEND-ONLY'dir çünkü
-- bir kalemin ne kadarının kapandığı ondan TÜRETİLİR. `payments` satırının
-- kendisi ise bir belgedir — iptal edilir (`void`), silinmez.

create type payment_method as enum
  ('cash', 'card', 'bank_transfer', 'gift_voucher', 'other');

create type payment_status as enum ('posted', 'void');

-- ---------------------------------------------------------------------------
-- Makbuz numarası — BOŞLUKSUZ artan
-- ---------------------------------------------------------------------------
-- PostgreSQL sequence KULLANILMAZ: sequence rollback'te boşluk bırakır ve
-- "makbuz numaraları boşluksuz artar" kabul kriterini ihlal ederdi. Sayaç
-- transaction'a bağlı bir advisory lock altında okunup artırılır.
create table receipt_sequences (
  tenant_id  uuid primary key references tenants(id) on delete cascade,
  next_value bigint not null default 1 check (next_value >= 1),
  updated_at timestamptz not null default now()
);

create or replace function next_receipt_no(p_tenant uuid) returns bigint
language plpgsql as $$
declare
  v_value bigint;
begin
  -- Kilit TRANSACTION boyunca tutulur; iki eş zamanlı tahsilat burada sıraya
  -- girer. `hashtextextended` ile uuid'den 64-bit anahtar: aynı kiracının
  -- tahsilatları aynı kilidi, farklı kiracılarınki farklı kilitleri alır.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text, 0));

  -- Tek ifadede "oku ve artır": ilk çağrıda satır 2 ile açılır ve 1 döner,
  -- sonrakilerde sayaç bir artar ve artıştan ÖNCEKİ değer döner. RETURNING,
  -- ON CONFLICT DO UPDATE'te güncellenmiş satırı gördüğü için `- 1` gerekir.
  insert into receipt_sequences (tenant_id, next_value)
  values (p_tenant, 2)
  on conflict (tenant_id) do update
    set next_value = receipt_sequences.next_value + 1,
        updated_at = now()
  returning next_value - 1 into v_value;

  return v_value;
end $$;

-- ---------------------------------------------------------------------------
-- Tahsilat
-- ---------------------------------------------------------------------------
create table payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,

  method       payment_method not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency     char(3) not null default 'TRY',
  receipt_no   bigint not null,
  paid_at      timestamptz not null default now(),

  -- 0029'da açık kasa oturumuna FK ile bağlanır ve nakit için ZORUNLU olur.
  cash_session_id uuid,

  note   text,
  status payment_status not null default 'posted',

  voided_at     timestamptz,
  voided_by     uuid references users(id),
  voided_reason text,

  collected_by uuid references users(id),
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint payments_void_fields check ((status = 'void') = (voided_at is not null)),
  constraint payments_void_reason check (
    status <> 'void' or length(trim(coalesce(voided_reason, ''))) >= 5
  )
);

create unique index payments_tenant_receipt_key on payments (tenant_id, receipt_no);

create index payments_customer_idx
  on payments (tenant_id, customer_id, paid_at desc, id desc);

create index payments_branch_time_idx
  on payments (tenant_id, branch_id, paid_at desc, id desc);

create index payments_cash_session_idx
  on payments (cash_session_id)
  where cash_session_id is not null;

-- ---------------------------------------------------------------------------
-- Dağıtım — APPEND-ONLY
-- ---------------------------------------------------------------------------
create table payment_allocations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  payment_id   uuid not null references payments(id) on delete restrict,
  charge_id    uuid not null references charges(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  created_at   timestamptz not null default now()
);

create index payment_allocations_payment_idx on payment_allocations (payment_id, id);
create index payment_allocations_charge_idx  on payment_allocations (charge_id, id);
create index payment_allocations_tenant_idx  on payment_allocations (tenant_id, created_at desc);

-- Aynı tahsilat aynı kaleme İKİ KEZ tahsis edilemez; iki satır yerine tek
-- satırda toplanır. Aksi hâlde "ne kadarı kapandı" sorgusu aynı işlemi iki
-- kez sayma riskini taşırdı.
create unique index payment_allocations_pair_key
  on payment_allocations (payment_id, charge_id);

-- ---------------------------------------------------------------------------
-- Kapsam ve tavan kuralları
-- ---------------------------------------------------------------------------
create or replace function payments_validate_scope() returns trigger
language plpgsql as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from customers where id = new.customer_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  select tenant_id into v_tenant from branches where id = new.branch_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

--
-- KİLİT SIRASI: önce `charges`, sonra `payments`. Sıra keyfi değil, deadlock
-- önlemidir ve 0024'teki "önce paket, sonra kalem" kararının aynısıdır.
-- INSERT'in yabancı anahtar kontrolleri her iki üst satır üzerinde KEY SHARE
-- alır; münhasır kilidi BEFORE trigger'da, yani FK kontrollerinden ÖNCE almak
-- tüm eş zamanlı tahsisleri tek bir noktada sıraya dizer.
--
create or replace function payment_allocations_validate() returns trigger
language plpgsql as $$
declare
  v_charge   charges%rowtype;
  v_payment  payments%rowtype;
  v_allocated bigint;
begin
  select * into v_charge from charges where id = new.charge_id for update;
  if not found or v_charge.tenant_id is distinct from new.tenant_id then
    raise exception 'Ücret kalemi başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  select * into v_payment from payments where id = new.payment_id for update;
  if not found or v_payment.tenant_id is distinct from new.tenant_id then
    raise exception 'Tahsilat başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if v_charge.customer_id is distinct from v_payment.customer_id then
    raise exception 'Tahsilat ve ücret kalemi aynı müşteriye ait olmalı.'
      using errcode = 'K0009';
  end if;

  -- İptal edilmiş bir kaleme para tahsis etmek, kapanmamış bir borcu
  -- kapatıyormuş gibi görünürdü.
  if v_charge.status <> 'open' then
    raise exception 'İptal edilmiş ücret kalemine tahsilat tahsis edilemez.'
      using errcode = 'K0010';
  end if;
  -- İade kalemi (negatif) tahsilatla kapanmaz; parası kasadan ÇIKAR (0029).
  if v_charge.total_minor <= 0 then
    raise exception 'İade kalemine tahsilat tahsis edilemez.' using errcode = 'K0010';
  end if;

  -- Kalemin kalan bakiyesi: iptal edilmiş tahsilatların tahsisleri sayılmaz.
  select coalesce(sum(a.amount_minor), 0) into v_allocated
    from payment_allocations a
    join payments p on p.id = a.payment_id
   where a.charge_id = new.charge_id
     and p.status = 'posted';

  if v_allocated + new.amount_minor > v_charge.total_minor then
    raise exception 'Tahsis (%) kalemin bakiyesini (%) aşıyor.',
      v_allocated + new.amount_minor, v_charge.total_minor
      using errcode = 'K0013';
  end if;

  return new;
end $$;

-- Tahsis toplamı tahsilatın kendisini aşamaz. DEFERRED: dağıtım satırları
-- ana satırdan SONRA yazılıyor, immediate bir kontrol her tahsilatta patlardı
-- (`customer_packages_allocation_check` ile aynı gerekçe).
create or replace function payments_validate_allocation() returns trigger
language plpgsql as $$
declare
  v_sum bigint;
begin
  if new.status = 'void' then return new; end if;

  select coalesce(sum(amount_minor), 0) into v_sum
    from payment_allocations where payment_id = new.id;

  if v_sum > new.amount_minor then
    raise exception 'Tahsis toplamı (%) tahsilat tutarını (%) aşıyor.',
      v_sum, new.amount_minor using errcode = 'K0012';
  end if;
  return new;
end $$;

create or replace function payments_guard_void() returns trigger
language plpgsql as $$
begin
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'İptal edilmiş tahsilat geri açılamaz.' using errcode = 'K0010';
  end if;
  return new;
end $$;

create or replace function payments_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

create trigger payments_scope_check
  before insert or update of tenant_id, customer_id, branch_id on payments
  for each row execute function payments_validate_scope();

create trigger payments_void_guard
  before update on payments
  for each row execute function payments_guard_void();

create trigger payments_version_bump
  before update on payments
  for each row execute function payments_bump_version();

create constraint trigger payments_allocation_check
  after insert or update on payments
  deferrable initially deferred
  for each row execute function payments_validate_allocation();

create trigger payment_allocations_validate_check
  before insert on payment_allocations
  for each row execute function payment_allocations_validate();

-- Dağıtım satırları asla değişmez / silinmez.
create trigger payment_allocations_immutable
  before update or delete on payment_allocations
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- Cari hesap view'ı: tahsilat bacağı eklenir
-- ---------------------------------------------------------------------------
-- `security_invoker` bayrağı BURADA DA ŞART; `create or replace` bayrağı
-- devralmaz ve düşerse RLS view sahibinin (BYPASSRLS) yetkisiyle atlanır.
create or replace view customer_account_entries with (security_invoker = true) as
select
  c.id            as entry_id,
  c.tenant_id,
  c.branch_id,
  c.customer_id,
  'charge'::text  as entry_kind,
  c.source::text  as entry_source,
  c.description,
  c.total_minor   as amount_minor,
  c.currency,
  c.created_at    as occurred_at
from charges c
where c.status = 'open'
union all
select
  p.id             as entry_id,
  p.tenant_id,
  p.branch_id,
  p.customer_id,
  'payment'::text  as entry_kind,
  p.method::text   as entry_source,
  'Tahsilat #' || p.receipt_no as description,
  -- ALACAK: cari hesapta borç pozitif, tahsilat negatiftir.
  -p.amount_minor  as amount_minor,
  p.currency,
  p.paid_at        as occurred_at
from payments p
where p.status = 'posted';

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table payments enable row level security;
alter table payments force row level security;
create policy payments_isolation on payments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table payment_allocations enable row level security;
alter table payment_allocations force row level security;
create policy payment_allocations_isolation on payment_allocations
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table receipt_sequences enable row level security;
alter table receipt_sequences force row level security;
create policy receipt_sequences_isolation on receipt_sequences
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger payments_set_updated_at
  before update on payments for each row execute function set_updated_at();

create trigger payments_audit
  after insert or update or delete on payments
  for each row execute function audit_row_change('tenant_id');

-- Tahsis satırları zaten değişmez bir defterdir; her satırını audit_log'a
-- kopyalamak yalnız yer harcardı (`package_ledger_entries` ile aynı gerekçe).

grant select, insert, update on payments to klinara_app;
revoke delete on payments from klinara_app;
grant select, insert on payment_allocations to klinara_app;
revoke update, delete on payment_allocations from klinara_app;
grant select, insert, update on receipt_sequences to klinara_app;
