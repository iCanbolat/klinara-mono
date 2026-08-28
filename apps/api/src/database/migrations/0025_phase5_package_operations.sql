-- Batch 5.3 — tüketim, iade, devir ve süre dolumu.
--
-- Tüketim bağı randevu KALEMİ üzerindedir, randevunun kendisinde değil: bir
-- randevunun bir hizmeti paketten, diğeri nakit olabilir; fiyat snapshot'ı
-- zaten kalem başına tutuluyor.

alter table appointment_services
  add column customer_package_item_id uuid
    references customer_package_items(id) on delete restrict,
  -- Tüketimin GERÇEKLEŞTİĞİNİ söyleyen tek yer. Ters kayıtta null'a döner ve
  -- randevu yeniden tamamlanabilir.
  add column package_consumed_entry_id uuid
    references package_ledger_entries(id);

-- Bir defter satırı en fazla bir randevu kalemine bağlanabilir.
create unique index appointment_services_consumed_entry_key
  on appointment_services (package_consumed_entry_id)
  where package_consumed_entry_id is not null;

create index appointment_services_package_item_idx
  on appointment_services (customer_package_item_id)
  where customer_package_item_id is not null;

-- ---------------------------------------------------------------------------
-- Kapsam doğrulaması genişletiliyor: yanlış müşterinin paketinden seans
-- düşmesi UYGULAMA HATASIYLA BİLE mümkün olmamalı (Faz 3'ün "son savunma
-- hattı DB" kararı).
-- ---------------------------------------------------------------------------
create or replace function appointment_services_validate_scope() returns trigger
language plpgsql as $$
declare
  v_appointment_tenant   uuid;
  v_appointment_branch   uuid;
  v_appointment_customer uuid;
  v_service_tenant       uuid;
  v_service_active       boolean;
  v_profile_tenant       uuid;
  v_profile_active       boolean;
  v_competent            boolean;
  v_item_tenant          uuid;
  v_item_service         uuid;
  v_package_customer     uuid;
  v_package_branch       uuid;
  v_package_status       customer_package_status;
begin
  select tenant_id, branch_id, customer_id
    into v_appointment_tenant, v_appointment_branch, v_appointment_customer
    from appointments where id = new.appointment_id;
  select tenant_id, is_active into v_service_tenant, v_service_active
    from services where id = new.service_id;
  select tenant_id, is_active into v_profile_tenant, v_profile_active
    from staff_profiles where id = new.staff_profile_id;

  if v_appointment_tenant is distinct from new.tenant_id
     or v_service_tenant  is distinct from new.tenant_id
     or v_profile_tenant  is distinct from new.tenant_id then
    raise exception 'Randevu kalemi başka bir kiracının kaydına bağlanamaz.'
      using errcode = 'check_violation';
  end if;

  if v_service_active is not true or v_profile_active is not true then
    raise exception 'Pasif hizmet veya pasif personel ile randevu oluşturulamaz.'
      using errcode = 'K0002';
  end if;

  select exists (
    select 1
      from staff_services ss
     where ss.staff_profile_id = new.staff_profile_id
       and ss.service_id       = new.service_id
       and ss.is_active
       and ss.deleted_at is null
       and (ss.branch_id is null or ss.branch_id = v_appointment_branch)
  ) into v_competent;

  if not v_competent then
    raise exception 'Personel bu hizmette yetkin değil.' using errcode = 'K0003';
  end if;

  if new.customer_package_item_id is not null then
    select i.tenant_id, i.service_id, p.customer_id, p.branch_id, p.status
      into v_item_tenant, v_item_service, v_package_customer, v_package_branch, v_package_status
      from customer_package_items i
      join customer_packages p on p.id = i.customer_package_id
     where i.id = new.customer_package_item_id;

    -- Bağlama hataları GENEL check_violation'dan ayrı bir SQLSTATE ile
    -- dönüyor: kiracı kapsamı ihlali bir sistem hatası, yanlış paket seçmek
    -- ise istemcinin düzeltebileceği bir girdi hatasıdır ve mesajı da öyle
    -- olmalı.
    if v_item_tenant is distinct from new.tenant_id then
      raise exception 'Paket kalemi başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
    if v_package_customer is distinct from v_appointment_customer then
      raise exception 'Paket randevunun müşterisine ait değil.' using errcode = 'K0009';
    end if;
    if v_item_service is distinct from new.service_id then
      raise exception 'Paket kalemi bu hizmete ait değil.' using errcode = 'K0009';
    end if;
    if v_package_branch is distinct from v_appointment_branch then
      -- Paket satıldığı şubede kullanılır. Şubeler arası kullanım bir devir
      -- işidir; sessizce izin vermek, şube cirosunu birbirine karıştırırdı.
      raise exception 'Paket başka bir şubede satılmış.' using errcode = 'K0009';
    end if;
    if v_package_status <> 'active' then
      raise exception 'Paket kullanılabilir durumda değil (%).', v_package_status
        using errcode = 'K0005';
    end if;
  end if;

  return new;
end $$;

drop trigger appointment_services_scope_check on appointment_services;
create trigger appointment_services_scope_check
  before insert or update of tenant_id, appointment_id, service_id, staff_profile_id,
                             customer_package_item_id
  on appointment_services
  for each row execute function appointment_services_validate_scope();

-- ---------------------------------------------------------------------------
-- İade — Faz 6 yokken sınır
-- ---------------------------------------------------------------------------
-- Kolonlar 0024'te açıldı. Burada yalnız niyet kaydı: paket modülü BORCUN
-- DOĞDUĞUNU yazar (`refund_settlement_status = 'pending'`), paranın nasıl
-- hareket ettiğini bilmez. Batch 6.2 bu satırları okuyup negatif charge üretir
-- ve 'settled'e çevirir.

-- ---------------------------------------------------------------------------
-- Devir
-- ---------------------------------------------------------------------------
-- Yalnız MÜŞTERİ devri. Hizmetler arası taşıma iki `manual_adjustment` ile
-- yapılır: hizmet devri seans başına parasal değeri de taşımayı gerektirir ve
-- bu, satılmış bir paketin tahsis satırlarını geçmişe dönük değiştirmek
-- demekti. Kalan hak taşınırken kalemlerin PARA kolonlarına dokunulmuyor;
-- yükümlülük `item_total × remaining / quantity_total` olduğu için kaynağın
-- borcu tam olarak taşınan değer kadar düşüyor, hedefinki o kadar artıyor.
create table package_transfers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  source_package_id uuid not null references customer_packages(id) on delete restrict,
  source_item_id    uuid not null references customer_package_items(id) on delete restrict,
  target_package_id uuid not null references customer_packages(id) on delete restrict,
  target_item_id    uuid not null references customer_package_items(id) on delete restrict,
  sessions          integer not null check (sessions > 0),
  -- Taşınan parasal karşılık. Yükümlülük raporu devir öncesi ve sonrası aynı
  -- toplamı vermeli; bu kolon o invariant'ın kanıtı.
  value_minor       bigint  not null check (value_minor >= 0),
  out_entry_id      uuid not null references package_ledger_entries(id),
  in_entry_id       uuid not null references package_ledger_entries(id),
  reason            text not null check (length(trim(reason)) >= 5),
  actor_user_id     uuid references users(id),
  created_at        timestamptz not null default now(),

  constraint package_transfers_distinct_items check (source_item_id <> target_item_id)
);

create index package_transfers_source_idx on package_transfers (tenant_id, source_package_id);
create index package_transfers_target_idx on package_transfers (tenant_id, target_package_id);

create trigger package_transfers_immutable
  before update or delete on package_transfers
  for each row execute function reject_mutation();

alter table package_transfers enable row level security;
alter table package_transfers force row level security;
create policy package_transfers_isolation on package_transfers
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert on package_transfers to klinara_app;
revoke update, delete on package_transfers from klinara_app;

-- ---------------------------------------------------------------------------
-- 5.3 izinleri — iade ve devir `package:write` üzerine BİNMEZ
-- ---------------------------------------------------------------------------
-- Gerekçe `customer:merge` ile birebir aynı: geri alınması pahalı, paraya
-- dokunan işlemler resepsiyonun günlük yazma iznine binerse yetkisiz iade
-- demektir.
insert into permissions (key, description) values
  ('package:refund',   'Paket iadesi (parasal yükümlülük doğurur)'),
  ('package:transfer', 'Paketi başka müşteriye devretme')
on conflict (key) do update set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',      'package:refund'),
  ('owner',      'package:transfer'),
  ('manager',    'package:refund'),
  ('manager',    'package:transfer'),
  ('accountant', 'package:refund')
on conflict do nothing;
