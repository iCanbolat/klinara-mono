-- Faz 3.0 — Müşteri çekirdeği.
--
-- Randevu bir müşteriye bağlanmak zorundadır ve `customer_bookings` doğrudan
-- bu tabloya referans verir; bu yüzden takvim fazının ÖNÜNDE gelir.
--
-- KAPSAM: yalnız kimlik alanları ve CRUD. Etiketler, mükerrer kayıt birleştirme
-- (merge) ve arama ucu Batch 4.1'e aittir ve BU tabloyu genişletir — yeniden
-- yazmaz. `pg_trgm` indeksi şimdiden kuruluyor: maliyeti yok, 4.1'de aramanın
-- şema değişikliği gerektirmemesini sağlıyor.

create table customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  full_name   text        not null check (length(trim(full_name)) > 0),
  -- E.164 (`+905321234567`). Uygulama `common/phone.ts` ile normalize eder;
  -- buradaki check yalnız biçimin bozulmadığını garanti eder.
  phone       text        check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email       citext,
  birth_date  date,
  gender      text        check (gender in ('female', 'male', 'other', 'undisclosed')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Telefon kiracı içinde tekildir: müşteri kartını bulmanın birincil yolu odur
-- ve iki kayıt aynı numarayı taşırsa hangi karta randevu yazıldığı belirsizleşir.
-- Kısmi indeks: numarası olmayan ve silinmiş kayıtlar tekilliğe girmez.
create unique index customers_tenant_phone_key
  on customers (tenant_id, phone)
  where phone is not null and deleted_at is null;

create index customers_tenant_created_idx
  on customers (tenant_id, created_at desc)
  where deleted_at is null;

-- Ad araması (Batch 4.1'in `GET /customers/search` ucu için hazır).
create index customers_full_name_trgm_idx
  on customers using gin (full_name gin_trgm_ops);

alter table customers enable row level security;
alter table customers force row level security;
create policy customers_isolation on customers
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger customers_set_updated_at
  before update on customers for each row execute function set_updated_at();

create trigger customers_audit
  after insert or update or delete on customers
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on customers to klinara_app;
