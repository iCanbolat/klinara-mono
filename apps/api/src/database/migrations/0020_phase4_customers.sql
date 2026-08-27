-- Batch 4.1 — müşteri kartının genişletilmesi: adres, geliş kaynağı, etiketler,
-- Türkçe duyarlı arama ve mükerrer kayıt birleştirme.
--
-- Batch 3.0 dar bir çekirdek açmıştı (ad, telefon, e-posta, doğum tarihi,
-- cinsiyet, not). Bu migration o tabloyu GENİŞLETİR, yeniden yazmaz.

-- ---------------------------------------------------------------------------
-- Türkçe duyarlı katlama
-- ---------------------------------------------------------------------------
-- `unaccent()` bilinçli olarak KULLANILMIYOR: STABLE'dır, yani indekslenemez.
-- Ayrıca Türkçe'de `ı` aksanlı bir `i` değil, AYRI bir temel harftir — unaccent
-- onu zaten çözmezdi. Açık harf haritası hem IMMUTABLE hem de doğru.
--
-- Yan fayda: Türkçe klavyesi olmayan kullanıcı "ayse" yazıp "Ayşe"yi bulur.
-- iOS istemcisindeki `SearchText` aynı haritayı kullanıyor; sunucu ve istemci
-- aynı sorguya aynı cevabı vermeli.
create or replace function klinara_fold_tr(value text) returns text
language sql immutable strict parallel safe as $$
  select lower(translate(value, 'İIıŞşĞğÜüÖöÇç', 'IIiSsGgUuOoCc'))
$$;

-- ---------------------------------------------------------------------------
-- customers — yeni kolonlar
-- ---------------------------------------------------------------------------
alter table customers
  add column address_line text,
  add column district     text,
  add column city         text,
  add column postal_code  text,
  add column source       text check (source in (
    'walk_in', 'referral', 'instagram', 'google', 'website', 'whatsapp', 'other'
  )),
  -- Birleştirilen kayıt SİLİNMEZ: arşivlenir ve hayatta kalana işaret eder.
  -- Eski kimliğe elinde link olan bir istemci "kayıt yok" yerine nereye
  -- gideceğini görebilmeli.
  add column merged_into_customer_id uuid references customers(id);

-- Arama metni: ad + telefon tek kolonda, katlanmış hâlde. Generated STORED
-- olması şart — ifade indeksi de olurdu ama sorgunun ifadeyi birebir tekrar
-- etmesi gerekirdi; kolon, sorguyu okunur tutuyor.
alter table customers
  add column search_text text generated always as (
    klinara_fold_tr(full_name || ' ' || coalesce(phone, ''))
  ) stored;

-- gin_trgm_ops hem `%` (benzerlik) hem de `like '%…%'` sorgularını destekler:
-- ad araması ve telefon parçası araması TEK indeksten besleniyor.
drop index if exists customers_full_name_trgm_idx;
create index customers_search_trgm_idx on customers using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Etiketler
-- ---------------------------------------------------------------------------
create table customer_tags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  color      text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tekillik katlanmış ada göre: "VIP", "Vip" ve "vıp" aynı etikettir.
create unique index customer_tags_tenant_name_key
  on customer_tags (tenant_id, klinara_fold_tr(name));

create table customer_tag_assignments (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  tag_id      uuid not null references customer_tags(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, tag_id)
);

create index customer_tag_assignments_tag_idx on customer_tag_assignments (tag_id);

-- FK doğrulaması RLS'i BYPASS eder: başka bir kiracının müşteri/etiket kimliği
-- FK'dan geçer. Kapsam kuralını trigger tutuyor (Faz 3'ün dersi).
create or replace function customer_tag_assignments_validate_scope() returns trigger
language plpgsql as $$
declare
  v_customer_tenant uuid;
  v_tag_tenant      uuid;
begin
  select tenant_id into v_customer_tenant from customers     where id = new.customer_id;
  select tenant_id into v_tag_tenant      from customer_tags where id = new.tag_id;
  if v_customer_tenant is distinct from new.tenant_id
     or v_tag_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri ve etiket aynı kiracıya ait olmalı.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger customer_tag_assignments_scope_check
  before insert on customer_tag_assignments
  for each row execute function customer_tag_assignments_validate_scope();

-- ---------------------------------------------------------------------------
-- Birleştirme kaydı — append-only
-- ---------------------------------------------------------------------------
-- "Bu iki kayıt neden tek oldu, ne taşındı, kim yaptı?" sorusu yıllar sonra da
-- cevaplanabilir olmalı; bu yüzden defter satırı gibi değişmez.
create table customer_merges (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  source_customer_id uuid not null references customers(id),
  target_customer_id uuid not null references customers(id),
  actor_user_id      uuid references users(id),
  -- { "appointments": 12, "customer_bookings": 12, ... }
  moved              jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  constraint customer_merges_distinct_ck check (source_customer_id <> target_customer_id)
);

create index customer_merges_source_idx on customer_merges (tenant_id, source_customer_id);

create trigger customer_merges_immutable
  before update or delete on customer_merges
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table customer_tags enable row level security;
alter table customer_tags force row level security;
create policy customer_tags_isolation on customer_tags
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table customer_tag_assignments enable row level security;
alter table customer_tag_assignments force row level security;
create policy customer_tag_assignments_isolation on customer_tag_assignments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table customer_merges enable row level security;
alter table customer_merges force row level security;
create policy customer_merges_isolation on customer_merges
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger customer_tags_set_updated_at
  before update on customer_tags for each row execute function set_updated_at();

create trigger customer_tags_audit
  after insert or update or delete on customer_tags
  for each row execute function audit_row_change('tenant_id');

create trigger customer_tag_assignments_audit
  after insert or delete on customer_tag_assignments
  for each row execute function audit_row_change('tenant_id');

-- customer_merges'e denetim trigger'ı YOK: tablo zaten değişmez bir olay
-- kaydıdır, her satırını ikinci kez audit_log'a kopyalamak yer harcardı.

grant select, insert, update, delete on customer_tags to klinara_app;
grant select, insert, delete on customer_tag_assignments to klinara_app;
grant select, insert on customer_merges to klinara_app;
revoke update, delete on customer_merges from klinara_app;

-- ---------------------------------------------------------------------------
-- İzin: customer:merge
-- ---------------------------------------------------------------------------
-- Birleştirme FK taşıyan ve geri alınması pahalı bir işlemdir; `customer:write`
-- ile resepsiyona açmak orantısız olurdu.
insert into permissions (key, description) values
  ('customer:merge', 'Mükerrer müşteri kayıtlarını birleştirme')
on conflict (key) do update
  set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',   'customer:merge'),
  ('manager', 'customer:merge')
on conflict do nothing;
