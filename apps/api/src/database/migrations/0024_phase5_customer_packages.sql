-- Batch 5.2 — paket satışı ve APPEND-ONLY seans hakkı defteri (bkz. 4.3).
--
-- Kalan hak defterden TÜRETİLİR. `remaining_sessions` yalnızca hızlı okuma
-- için trigger'la güncellenen bir yansımadır ve defter toplamıyla daima
-- eşittir. Eşzamanlılık garantisi uygulamada değil burada: apply trigger'ının
-- UPDATE'i kalem satırını kilitler, ikinci eş zamanlı tüketim güncellenmiş
-- değeri okur ve hak yetersizse K0004 alır.

create type ledger_entry_type as enum
  ('purchase', 'consume', 'refund', 'transfer_in', 'transfer_out', 'expire', 'manual_adjustment');

create type customer_package_status as enum ('active', 'expired', 'refunded', 'transferred');

create type package_refund_settlement as enum ('pending', 'settled');

create table customer_packages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  customer_id   uuid not null references customers(id) on delete restrict,
  branch_id     uuid not null references branches(id) on delete restrict,
  -- Yalnız İZ. Satışın gerçeği aşağıdaki snapshot kolonlarıdır; tanım
  -- değişince satılmış paket kıpırdamaz.
  definition_id uuid references package_definitions(id) on delete restrict,

  definition_name     text    not null,
  definition_revision integer not null,
  total_price_minor   bigint  not null check (total_price_minor >= 0),
  currency            char(3) not null default 'TRY',
  is_transferable     boolean not null,
  validity_days       integer,

  sold_at    timestamptz not null default now(),
  expires_at timestamptz,
  status     customer_package_status not null default 'active',
  -- Kalemlerin toplamı; roll-up. Tek başına otorite DEĞİL.
  remaining_sessions integer not null default 0,

  refunded_sessions        integer not null default 0 check (refunded_sessions >= 0),
  refund_amount_minor      bigint  not null default 0 check (refund_amount_minor >= 0),
  refund_reason            text,
  refunded_at              timestamptz,
  refunded_by              uuid references users(id),
  -- Faz 6 yok: paket modülü BORCUN DOĞDUĞUNU kaydeder, paranın nasıl
  -- hareket ettiğini bilmez. Batch 6.2 bu satırları okuyup kasaya bağlar.
  refund_settlement_status package_refund_settlement,

  -- Devir izi: bu paket başka bir paketten doğduysa kaynağı gösterir.
  transferred_from_package_id uuid references customer_packages(id) on delete set null,

  sold_by uuid references users(id),
  note    text,
  version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint customer_packages_remaining_non_negative check (remaining_sessions >= 0),
  constraint customer_packages_expiry_after_sale
    check (expires_at is null or expires_at > sold_at),
  constraint customer_packages_refund_fields
    check ((refunded_at is null) = (refund_settlement_status is null))
);

create index customer_packages_customer_idx
  on customer_packages (tenant_id, customer_id, sold_at desc, id desc)
  where deleted_at is null;

create index customer_packages_status_idx
  on customer_packages (tenant_id, status)
  where deleted_at is null;

create index customer_packages_definition_idx
  on customer_packages (definition_id)
  where definition_id is not null;

create table customer_package_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  customer_package_id uuid not null references customer_packages(id) on delete cascade,
  service_id          uuid not null references services(id) on delete restrict,
  service_name        text not null,
  -- Satılan seans sayısı. Devirde ya da iadede DEĞİŞMEZ: seans başına değerin
  -- paydası budur, oynatmak geçmişe dönük fiyat değiştirmek olurdu.
  quantity_total      integer not null check (quantity_total >= 0),
  remaining_sessions  integer not null default 0,
  -- Gösterim: liste fiyatı ile satış fiyatı arasındaki fark buradan okunur.
  unit_list_price_minor bigint not null check (unit_list_price_minor >= 0),
  -- PARA BURADAN. Paketin gerçek satış tutarının bu kaleme düşen payı;
  -- sum(item_total_minor) = customer_packages.total_price_minor.
  item_total_minor      bigint not null check (item_total_minor >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_package_items_remaining_non_negative check (remaining_sessions >= 0)
);

create unique index customer_package_items_service_key
  on customer_package_items (customer_package_id, service_id);

create index customer_package_items_package_idx
  on customer_package_items (customer_package_id, sort_order, id);

create table package_ledger_entries (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  customer_package_id      uuid not null references customer_packages(id) on delete restrict,
  customer_package_item_id uuid not null references customer_package_items(id) on delete restrict,
  entry_type               ledger_entry_type not null,
  delta                    integer not null,
  appointment_id           uuid references appointments(id) on delete set null,
  appointment_service_id   uuid references appointment_services(id) on delete set null,
  actor_user_id            uuid references users(id),
  reason                   text,
  reverses_entry_id        uuid references package_ledger_entries(id),
  created_at               timestamptz not null default now(),

  constraint package_ledger_delta_sign check (
    delta <> 0 and (
      reverses_entry_id is not null
      or (entry_type in ('purchase', 'transfer_in') and delta > 0)
      or (entry_type in ('consume', 'refund', 'transfer_out', 'expire') and delta < 0)
      or entry_type = 'manual_adjustment'
    )
  ),
  constraint package_ledger_reason_required check (
    entry_type <> 'manual_adjustment' or length(trim(coalesce(reason, ''))) >= 5
  )
);

create index package_ledger_package_idx
  on package_ledger_entries (customer_package_id, created_at desc, id desc);

create index package_ledger_tenant_time_idx
  on package_ledger_entries (tenant_id, created_at desc, id desc);

-- Bir kayıt EN FAZLA BİR KEZ geri alınabilir.
create unique index package_ledger_reversal_once
  on package_ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;

-- ---------------------------------------------------------------------------
-- Kapsam doğrulaması ve iş kuralları
-- ---------------------------------------------------------------------------
create or replace function customer_packages_validate_scope() returns trigger
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

  if new.definition_id is not null then
    select tenant_id into v_tenant from package_definitions where id = new.definition_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Paket tanımı başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function customer_package_items_validate_scope() returns trigger
language plpgsql as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from customer_packages where id = new.customer_package_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri paketi başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  select tenant_id into v_tenant from services where id = new.service_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Hizmet başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if new.remaining_sessions > new.quantity_total then
    raise exception 'Kalan hak satılan seans sayısını aşamaz.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

--
-- KİLİT SIRASI BURADA KURULUR: önce paket, sonra kalem. Sıra keyfi değil,
-- deadlock önlemidir ve BEFORE trigger'da olması şarttır.
--
-- INSERT'in yabancı anahtar kontrolleri her iki üst satır üzerinde KEY SHARE
-- alır. İki eş zamanlı tüketim bu paylaşımlı kilitleri aynı anda tutup
-- ardından AFTER trigger'da münhasır kilide YÜKSELTMEYE çalışırsa PostgreSQL
-- deadlock verir (gözlendi: 10 paralel tüketimin 3'ü 40P01). BEFORE trigger
-- FK kontrollerinden ÖNCE koştuğu için münhasır kilidi burada almak, tüm eş
-- zamanlı yazımları tek bir noktada sıraya dizer.
create or replace function package_ledger_validate_scope() returns trigger
language plpgsql as $$
declare
  v_item_package uuid;
  v_item_tenant  uuid;
  v_status       customer_package_status;
  v_expires_at   timestamptz;
begin
  select status, expires_at into v_status, v_expires_at
    from customer_packages where id = new.customer_package_id
     for update;

  select customer_package_id, tenant_id into v_item_package, v_item_tenant
    from customer_package_items where id = new.customer_package_item_id
     for update;

  if v_item_tenant is distinct from new.tenant_id then
    raise exception 'Paket kalemi başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;
  if v_item_package is distinct from new.customer_package_id then
    raise exception 'Defter satırı kalemin paketiyle uyuşmuyor.' using errcode = 'check_violation';
  end if;

  -- Tüketim yalnız YAŞAYAN bir paketten yapılabilir. Süre dolumu job'ı gece
  -- koşar; gündüz süresi dolmuş bir paketten tüketim yine de reddedilmeli,
  -- yani kural burada, süpürücüde değil.
  if new.entry_type = 'consume' and new.delta < 0 then
    if v_status <> 'active' then
      raise exception 'Paket aktif değil (%).', v_status using errcode = 'K0005';
    end if;
    if v_expires_at is not null and v_expires_at <= now() then
      raise exception 'Paketin geçerlilik süresi dolmuş.' using errcode = 'K0005';
    end if;
  end if;
  return new;
end $$;

create or replace function package_ledger_validate_reversal() returns trigger
language plpgsql as $$
declare
  v_original package_ledger_entries%rowtype;
begin
  if new.reverses_entry_id is null then return new; end if;

  select * into v_original from package_ledger_entries where id = new.reverses_entry_id;
  if not found then
    raise exception 'Ters kaydın işaret ettiği defter satırı yok.' using errcode = 'check_violation';
  end if;
  if v_original.customer_package_item_id is distinct from new.customer_package_item_id
     or v_original.entry_type is distinct from new.entry_type
     or v_original.delta is distinct from -new.delta
  then
    raise exception 'Ters kayıt orijinal satırın tam tersi olmalı.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Bakiyeyi DEFTER doldurur. Servis remaining_sessions'a asla yazmaz.
create or replace function apply_package_ledger_entry() returns trigger
language plpgsql as $$
declare
  v_remaining integer;
begin
  -- SIRA SABİT: önce kalem, sonra paket. Kilit sırası tek yönlü olduğu için
  -- aynı paketin iki kalemine eş zamanlı tüketim deadlock üretmez.
  --
  -- Satır kilidi BEFORE trigger'da (package_ledger_validate_scope) alındı;
  -- buradaki okuma onun altında, güncel değeri görür.
  --
  -- Hak kontrolü YAZMADAN ÖNCE yapılıyor: doğrudan UPDATE edilseydi yetersiz
  -- hak satır seviyesindeki CHECK constraint'ine takılır ve istemciye anlamsız
  -- bir 23514 dönerdi. Constraint arkada erişilmez bir son savunma hattı
  -- olarak duruyor.
  select remaining_sessions into v_remaining
    from customer_package_items
   where id = new.customer_package_item_id;

  if not found then
    raise exception 'Paket kalemi bulunamadı.' using errcode = 'check_violation';
  end if;

  if v_remaining + new.delta < 0 then
    raise exception 'Paket hakkı yetersiz (kalem=%).', new.customer_package_item_id
      using errcode = 'K0004';
  end if;

  update customer_package_items
     set remaining_sessions = v_remaining + new.delta
   where id = new.customer_package_item_id;

  update customer_packages
     set remaining_sessions = remaining_sessions + new.delta
   where id = new.customer_package_id;
  return new;
end $$;

create or replace function customer_packages_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

-- Tahsis toplamı satış tutarına EŞİT olmalı. Deferred: kalemler ana satırdan
-- SONRA yazılıyor, immediate bir kontrol her satışta patlardı.
create or replace function customer_packages_validate_allocation() returns trigger
language plpgsql as $$
declare
  v_sum bigint;
begin
  select coalesce(sum(item_total_minor), 0) into v_sum
    from customer_package_items where customer_package_id = new.id;
  if v_sum <> new.total_price_minor then
    raise exception 'Kalem tahsisi (%) paket toplamıyla (%) uyusmuyor.',
      v_sum, new.total_price_minor using errcode = 'K0008';
  end if;
  return new;
end $$;

create trigger customer_packages_scope_check
  before insert or update of tenant_id, customer_id, branch_id, definition_id
  on customer_packages
  for each row execute function customer_packages_validate_scope();

create trigger customer_packages_version_bump
  before update on customer_packages
  for each row execute function customer_packages_bump_version();

create constraint trigger customer_packages_allocation_check
  after insert or update on customer_packages
  deferrable initially deferred
  for each row execute function customer_packages_validate_allocation();

create trigger customer_package_items_scope_check
  before insert or update on customer_package_items
  for each row execute function customer_package_items_validate_scope();

create trigger package_ledger_scope_check
  before insert on package_ledger_entries
  for each row execute function package_ledger_validate_scope();

create trigger package_ledger_reversal_check
  before insert on package_ledger_entries
  for each row execute function package_ledger_validate_reversal();

create trigger package_ledger_apply
  after insert on package_ledger_entries
  for each row execute function apply_package_ledger_entry();

-- Defter satırları asla değişmez / silinmez.
create trigger package_ledger_immutable
  before update or delete on package_ledger_entries
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- 5.1'den devreden: satılmış paket tanımı silinemez.
-- Kural ancak satış tablosu var olduğunda ANLAMLI; bu yüzden burada.
-- ---------------------------------------------------------------------------
create or replace function package_definitions_guard_delete() returns trigger
language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and exists (select 1 from customer_packages where definition_id = new.id)
  then
    raise exception 'Satılmış paket tanımı silinemez; pasife alınmalıdır.'
      using errcode = 'K0007';
  end if;
  return new;
end $$;

create trigger package_definitions_delete_guard
  before update of deleted_at on package_definitions
  for each row execute function package_definitions_guard_delete();

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table customer_packages enable row level security;
alter table customer_packages force row level security;
create policy customer_packages_isolation on customer_packages
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table customer_package_items enable row level security;
alter table customer_package_items force row level security;
create policy customer_package_items_isolation on customer_package_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table package_ledger_entries enable row level security;
alter table package_ledger_entries force row level security;
create policy package_ledger_entries_isolation on package_ledger_entries
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger customer_packages_set_updated_at
  before update on customer_packages for each row execute function set_updated_at();

create trigger customer_package_items_set_updated_at
  before update on customer_package_items for each row execute function set_updated_at();

create trigger customer_packages_audit
  after insert or update or delete on customer_packages
  for each row execute function audit_row_change('tenant_id');

create trigger customer_package_items_audit
  after insert or update or delete on customer_package_items
  for each row execute function audit_row_change('tenant_id');

-- Defterin kendisi zaten denetim kaydıdır; her satırını audit_log'a
-- kopyalamak yalnız yer harcardı (customer_record_access_log ile aynı gerekçe).

grant select, insert, update, delete on customer_packages to klinara_app;
grant select, insert, update, delete on customer_package_items to klinara_app;
grant select, insert on package_ledger_entries to klinara_app;
revoke update, delete on package_ledger_entries from klinara_app;
