-- Batch 6.1 — ücret kalemleri, indirim ve cari hesap.
--
-- Faz 5 "10 seans hakkı doğdu" diyebiliyordu ama "15.000 TL borç doğdu"
-- diyemiyordu. Bu migration BORCUN DOĞDUĞU YERİ kurar; paranın girdiği yer
-- 0028'de (payments), sayıldığı yer 0029'da (kasa).
--
-- İki karar bu dosyanın tamamını açıklar:
--
-- 1. KDV FİYATA DAHİLDİR. `services.price_minor` müşteriye söylenen brüt
--    tutardır; `vat_minor` onun İÇİNDEN çıkarılır. Bu yüzden hiçbir yerde
--    "net + KDV = brüt" hesaplaması yapılmaz, `net = brüt - KDV` yapılır.
--
-- 2. `charges` APPEND-ONLY DEĞİLDİR. `package_ledger_entries` değişmezdir
--    çünkü SAYAÇ ondan türetilir; `charges` ise bir belge satırıdır,
--    düzeltilir ve `void` edilir. Değişmezlik ihtiyacını audit trigger'ı
--    karşılar. Buna karşılık `payment_allocations` (0028) ve
--    `commission_accruals` (0030) append-only'dir — bakiye onlardan türetilir.

create type charge_source as enum
  ('appointment_service', 'package_sale', 'package_refund', 'product', 'manual');

create type charge_status as enum ('open', 'void');

create type discount_kind as enum ('percent', 'amount');

create type discount_scope as enum ('all', 'service', 'package');

-- ---------------------------------------------------------------------------
-- İndirim tanımları
-- ---------------------------------------------------------------------------
create table discounts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  -- Kampanya kodu. null = kodsuz, yalnız elle seçilen indirim.
  code       citext,
  name       text not null check (length(trim(name)) > 0),
  kind       discount_kind not null,
  -- `percent` için BAZ PUAN (1500 = %15), `amount` için minor unit.
  -- Tek kolonda iki birim taşımak kasıtlı: indirimin iki türü de aynı
  -- satırda yaşamalı, iki nullable kolon her sorguya coalesce eklerdi.
  value      integer not null check (value >= 0),
  scope      discount_scope not null default 'all',
  -- `scope='service'` ise services(id), `scope='package'` ise
  -- package_definitions(id). Polimorfik olduğu için FK yok; kapsam
  -- doğrulaması trigger'da.
  scope_ref_id uuid,
  starts_at  timestamptz,
  ends_at    timestamptz,
  -- null = sınırsız.
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  -- Trigger'la güncellenen yansıma; otorite `charges` satırlarının sayısıdır.
  redeemed_count  integer not null default 0 check (redeemed_count >= 0),
  is_active  boolean not null default true,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint discounts_percent_range
    check (kind <> 'percent' or value <= 10000),
  constraint discounts_window
    check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint discounts_scope_ref
    check ((scope = 'all') = (scope_ref_id is null))
);

create unique index discounts_tenant_code_key
  on discounts (tenant_id, code)
  where deleted_at is null and code is not null;

create index discounts_tenant_idx
  on discounts (tenant_id, created_at desc, id desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Ücret kalemleri
-- ---------------------------------------------------------------------------
create table charges (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,

  source charge_source not null,
  -- Kaynak izi. Randevu kalemi silinirse borç kalemi AYAKTA KALIR: para
  -- hareketine bağlı bir satır, kaynağı gitti diye kaybolamaz.
  appointment_service_id uuid references appointment_services(id) on delete set null,
  customer_package_id    uuid references customer_packages(id) on delete set null,

  -- Snapshot: katalog sonradan değişse de fatura satırının metni değişmez.
  description text not null check (length(trim(description)) > 0),
  quantity    integer not null default 1 check (quantity > 0),

  -- Katalogdan gelen liste fiyatı — YALNIZ GÖSTERİM. "Ne kadar indirim
  -- yapıldı" sorusunun paydası budur, hesaba girmez.
  unit_list_price_minor bigint not null check (unit_list_price_minor >= 0),
  -- Uygulanan birim fiyat. `unit_list_price_minor`dan farklıysa override
  -- yapılmıştır ve gerekçesi zorunludur (aşağıdaki constraint).
  unit_price_minor      bigint not null check (unit_price_minor >= 0),

  discount_id     uuid references discounts(id) on delete set null,
  -- İndirimin SATIŞ ANINDAKİ hâli; tanım sonradan değişse bu kalem kıpırdamaz.
  discount_kind   discount_kind,
  discount_value  integer check (discount_value is null or discount_value >= 0),
  discount_minor  bigint not null default 0 check (discount_minor >= 0),

  vat_rate_basis_points integer not null default 2000
    check (vat_rate_basis_points between 0 and 10000),
  -- KDV DAHİL brüt tutar. Diğer ikisi bundan TÜRETİLİR.
  total_minor bigint not null,
  net_minor   bigint not null,
  vat_minor   bigint not null,
  currency    char(3) not null default 'TRY',

  status charge_status not null default 'open',

  -- Fiyat override izi (`finance.price:override`).
  price_override_reason text,
  price_overridden_by   uuid references users(id),

  voided_at     timestamptz,
  voided_by     uuid references users(id),
  voided_reason text,

  created_by uuid references users(id),
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- İşaret: iade kalemi negatiftir, geri kalan her şey pozitif.
  constraint charges_sign check (
    (source = 'package_refund' and total_minor <= 0)
    or (source <> 'package_refund' and total_minor >= 0)
  ),
  -- Aritmetiğin TAMAMI burada kilitli. Uygulama yanlış hesaplarsa satır yazılmaz.
  constraint charges_total_parts check (total_minor = net_minor + vat_minor),
  constraint charges_total_from_line
    check (total_minor = unit_price_minor * quantity - discount_minor
           or source = 'package_refund'),
  -- "İndirim sonrası tutar negatife düşemez" — kabul kriteri.
  constraint charges_discount_within_line
    check (source = 'package_refund' or discount_minor <= unit_price_minor * quantity),
  constraint charges_discount_snapshot
    check ((discount_kind is null) = (discount_value is null)),
  -- Override yapıldıysa gerekçe ZORUNLU. Gerekçesiz override, denetimde
  -- "kim niye indirim yaptı" sorusunun cevapsız kalması demekti.
  --
  -- Paket kalemleri MUAF: orada `unit_list_price_minor` katalog fiyatı değil,
  -- KAMPANYA KARŞILAŞTIRMASIDIR (liste toplamı ile satış tahsisi farklıdır ve
  -- bu bir override değil, paketin kendi indirimidir). Kuralı oraya da
  -- dayatmak, her kampanyalı paket satışını gerekçe istemeye zorlardı.
  constraint charges_override_reason check (
    source in ('package_sale', 'package_refund')
    or unit_price_minor = unit_list_price_minor
    or (length(trim(coalesce(price_override_reason, ''))) >= 5
        and price_overridden_by is not null)
  ),
  constraint charges_void_fields check (
    (status = 'void') = (voided_at is not null)
  )
);

create index charges_customer_idx
  on charges (tenant_id, customer_id, created_at desc, id desc);

create index charges_branch_time_idx
  on charges (tenant_id, branch_id, created_at desc, id desc);

create index charges_appointment_service_idx
  on charges (appointment_service_id)
  where appointment_service_id is not null;

create index charges_package_idx
  on charges (customer_package_id)
  where customer_package_id is not null;

create index charges_discount_idx
  on charges (discount_id)
  where discount_id is not null;

-- Bir randevu kalemi için EN FAZLA BİR açık ücret kalemi. Randevu iki kez
-- `completed` yapılırsa (ya da iki istek yarışırsa) müşteri iki kez
-- borçlanmamalı; idempotence buradan gelir, uygulamanın dikkatinden değil.
create unique index charges_appointment_service_once
  on charges (appointment_service_id)
  where appointment_service_id is not null and status = 'open';

-- ---------------------------------------------------------------------------
-- Kapsam ve iş kuralları
-- ---------------------------------------------------------------------------
create or replace function charges_validate_scope() returns trigger
language plpgsql as $$
declare
  v_tenant   uuid;
  v_customer uuid;
begin
  select tenant_id into v_tenant from customers where id = new.customer_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  select tenant_id into v_tenant from branches where id = new.branch_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Şube başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if new.appointment_service_id is not null then
    select s.tenant_id, a.customer_id into v_tenant, v_customer
      from appointment_services s
      join appointments a on a.id = s.appointment_id
     where s.id = new.appointment_service_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Randevu kalemi başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
    -- Borç, hizmeti ALAN kişiye yazılır. Bu kontrol olmasaydı bir randevunun
    -- ücreti sessizce başka bir müşterinin cari hesabına düşebilirdi.
    if v_customer is distinct from new.customer_id then
      raise exception 'Ücret kalemi randevunun müşterisiyle uyuşmuyor.'
        using errcode = 'K0009';
    end if;
  end if;

  if new.customer_package_id is not null then
    select tenant_id, customer_id into v_tenant, v_customer
      from customer_packages where id = new.customer_package_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Müşteri paketi başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
    if v_customer is distinct from new.customer_id then
      raise exception 'Ücret kalemi paketin müşterisiyle uyuşmuyor.'
        using errcode = 'K0009';
    end if;
  end if;

  return new;
end $$;

-- İndirim geçerliliği YAZIM ANINDA doğrulanır. Süresi dolmuş bir kampanyayı
-- uygulamanın hatırlaması yeterli değil: iki istek yarışırsa `max_redemptions`
-- aşılabilir, o yüzden sayaç da kilit de burada.
create or replace function charges_validate_discount() returns trigger
language plpgsql as $$
declare
  v_discount discounts%rowtype;
begin
  if new.discount_id is null then return new; end if;

  select * into v_discount from discounts where id = new.discount_id for update;
  if not found or v_discount.tenant_id is distinct from new.tenant_id then
    raise exception 'İndirim başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;
  if v_discount.deleted_at is not null or not v_discount.is_active then
    raise exception 'İndirim aktif değil.' using errcode = 'K0011';
  end if;
  if v_discount.starts_at is not null and v_discount.starts_at > now() then
    raise exception 'İndirim henüz başlamadı.' using errcode = 'K0011';
  end if;
  if v_discount.ends_at is not null and v_discount.ends_at <= now() then
    raise exception 'İndirimin süresi dolmuş.' using errcode = 'K0011';
  end if;
  if v_discount.max_redemptions is not null
     and v_discount.redeemed_count >= v_discount.max_redemptions then
    raise exception 'İndirim kullanım hakkı tükenmiş.' using errcode = 'K0011';
  end if;

  return new;
end $$;

-- Sayaç kalemin YAŞAM DÖNGÜSÜNÜ izler: açılınca artar, `void` olunca düşer.
-- Böylece iptal edilen bir satış kampanya kotasını yemez.
create or replace function charges_apply_discount_count() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.discount_id is not null and new.status = 'open' then
      update discounts set redeemed_count = redeemed_count + 1 where id = new.discount_id;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.discount_id is not distinct from new.discount_id
       and old.status is not distinct from new.status then
      return new;
    end if;
    if old.discount_id is not null and old.status = 'open' then
      update discounts set redeemed_count = greatest(redeemed_count - 1, 0)
       where id = old.discount_id;
    end if;
    if new.discount_id is not null and new.status = 'open' then
      update discounts set redeemed_count = redeemed_count + 1 where id = new.discount_id;
    end if;
  end if;
  return new;
end $$;

-- İptal edilmiş kalem DONAR. Tek izinli geçiş `void`e gitmektir; `void`den
-- geri dönüş yoktur (düzeltme yeni kalem açmakla yapılır — bir belgeyi
-- iptal edip aynı numarayla diriltmek muhasebede yapılmaz).
create or replace function charges_guard_void() returns trigger
language plpgsql as $$
begin
  if old.status = 'void' then
    if new.status <> 'void' then
      raise exception 'İptal edilmiş ücret kalemi geri açılamaz.' using errcode = 'K0010';
    end if;
    if to_jsonb(new) - 'updated_at' - 'version' is distinct from
       to_jsonb(old) - 'updated_at' - 'version' then
      raise exception 'İptal edilmiş ücret kalemi değiştirilemez.' using errcode = 'K0010';
    end if;
  end if;
  return new;
end $$;

create or replace function charges_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

create or replace function discounts_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

create trigger charges_scope_check
  before insert or update of tenant_id, customer_id, branch_id,
    appointment_service_id, customer_package_id
  on charges
  for each row execute function charges_validate_scope();

create trigger charges_discount_check
  before insert or update of discount_id on charges
  for each row execute function charges_validate_discount();

create trigger charges_void_guard
  before update on charges
  for each row execute function charges_guard_void();

create trigger charges_version_bump
  before update on charges
  for each row execute function charges_bump_version();

create trigger charges_discount_count
  after insert or update of discount_id, status on charges
  for each row execute function charges_apply_discount_count();

create trigger discounts_version_bump
  before update on discounts
  for each row execute function discounts_bump_version();

-- ---------------------------------------------------------------------------
-- Cari hesap — TABLO DEĞİL, VIEW
-- ---------------------------------------------------------------------------
-- Kabul kriteri: "Cari bakiye = sum(charges) - sum(payments), hiçbir yerde
-- ayrıca saklanmaz." Ayrı bir tablo, senkron tutulması gereken ÜÇÜNCÜ bir
-- gerçek kaynağı olurdu. 0028 bu view'ı `create or replace` ile genişletip
-- tahsilat bacağını ekler.
--
-- ⚠️ `security_invoker = true` ŞART. Varsayılanda bir view, SAHİBİNİN
-- yetkisiyle çalışır; bu view'ın sahibi `klinara_owner` ve o rol BYPASSRLS'tir.
-- Bayrak olmasaydı `charges` üzerindeki RLS politikası hiç değerlendirilmez ve
-- cari hesap ucu TÜM KİRACILARIN satırlarını görürdü.
create view customer_account_entries with (security_invoker = true) as
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
where c.status = 'open';

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table discounts enable row level security;
alter table discounts force row level security;
create policy discounts_isolation on discounts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table charges enable row level security;
alter table charges force row level security;
create policy charges_isolation on charges
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger discounts_set_updated_at
  before update on discounts for each row execute function set_updated_at();

create trigger charges_set_updated_at
  before update on charges for each row execute function set_updated_at();

create trigger discounts_audit
  after insert or update or delete on discounts
  for each row execute function audit_row_change('tenant_id');

create trigger charges_audit
  after insert or update or delete on charges
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on discounts to klinara_app;
grant select, insert, update on charges to klinara_app;
-- Ücret kalemi SİLİNMEZ, `void` edilir. Silme hakkını hiç vermemek,
-- "yanlışlıkla silme" ihtimalini modelden çıkarır.
revoke delete on charges from klinara_app;
grant select on customer_account_entries to klinara_app;

-- ---------------------------------------------------------------------------
-- 6.1 izinleri
-- ---------------------------------------------------------------------------
-- `finance.price:override` `finance.payment:write` üzerine BİNMEZ; gerekçe
-- `package:refund` (0025) ile birebir aynı: resepsiyonun günlük tahsilat
-- iznine binen bir fiyat override'ı, yetkisiz indirim demektir.
insert into permissions (key, description) values
  ('finance.price:override', 'Katalog fiyatının dışına çıkma (gerekçe zorunlu)')
on conflict (key) do update set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',   'finance.price:override'),
  ('manager', 'finance.price:override')
on conflict do nothing;
