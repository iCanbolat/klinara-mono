-- Kapsam daraltma — tahsilat, kasa, iade, prim, indirim ve muhasebe rolü.
--
-- Ürün randevu odağına çekildi. Faz 6'nın "paranın girdiği ve sayıldığı yer"
-- katmanı (0028 payments, 0029 kasa/iade, 0030 prim) ve 0027'nin indirim ile
-- cari hesap parçası KALDIRILIYOR.
--
-- KALAN: `charges`. Randevu tamamlanınca ve paket satılınca doğan hizmet
-- bedeli; ciro raporu, dashboard'daki aylık ciro ve personel performansı
-- ondan hesaplanıyor. Borç "tahsil edildi mi" sorusu artık sorulmuyor.
--
-- Uygulanmış migration'lar düzenlenmiyor (checksum); geri dönüş yeni bir
-- migration ile yapılır.

-- ---------------------------------------------------------------------------
-- 1. Prim (0030)
-- ---------------------------------------------------------------------------
drop table if exists commission_accruals;
drop table if exists commission_periods;
drop table if exists commission_rules;

drop function if exists commission_accruals_validate();
drop function if exists commission_rules_validate_scope();
drop function if exists commission_periods_guard_close();
drop function if exists commission_rules_bump_version();
drop function if exists commission_periods_bump_version();

drop type if exists commission_scope;
drop type if exists commission_calc_kind;
drop type if exists commission_basis;
drop type if exists commission_trigger;
drop type if exists commission_period_status;

-- ---------------------------------------------------------------------------
-- 2. Kasa ve iade (0029)
-- ---------------------------------------------------------------------------
drop table if exists cash_movements;
drop table if exists refunds;
alter table payments drop constraint if exists payments_cash_session_fk;
drop trigger if exists payments_cash_session_check on payments;
drop table if exists cash_register_sessions;

drop function if exists payments_validate_cash_session();
drop function if exists cash_movements_validate();
drop function if exists cash_sessions_guard_close();
drop function if exists cash_sessions_bump_version();
drop function if exists refunds_validate_scope();

drop type if exists cash_movement_kind;
drop type if exists refund_kind;

-- ---------------------------------------------------------------------------
-- 3. Tahsilat (0028) ve cari hesap view'ı
-- ---------------------------------------------------------------------------
drop view if exists customer_account_entries;

drop table if exists payment_allocations;
drop table if exists payments;
drop table if exists receipt_sequences;

drop function if exists next_receipt_no(uuid);
drop function if exists payments_validate_scope();
drop function if exists payment_allocations_validate();
drop function if exists payments_validate_allocation();
drop function if exists payments_guard_void();
drop function if exists payments_bump_version();

drop type if exists payment_method;
drop type if exists payment_status;

-- ---------------------------------------------------------------------------
-- 4. İndirim (0027) — `charges` kalıyor, indirim kolonları gidiyor
-- ---------------------------------------------------------------------------
drop trigger if exists charges_discount_check on charges;
drop trigger if exists charges_discount_count on charges;
drop function if exists charges_validate_discount();
drop function if exists charges_apply_discount_count();

alter table charges drop constraint if exists charges_total_from_line;
alter table charges drop constraint if exists charges_discount_within_line;
alter table charges drop constraint if exists charges_discount_snapshot;
drop index if exists charges_discount_idx;

alter table charges
  drop column if exists discount_id,
  drop column if exists discount_kind,
  drop column if exists discount_value,
  drop column if exists discount_minor;

-- Aritmetik kilidi indirimsiz hâliyle geri geliyor. `not valid`: indirimle
-- yazılmış GEÇMİŞ satırlar (total = fiyat × adet - indirim) tarihsel belge,
-- tutarları yeniden yazılmıyor; kural yalnız yeni ve güncellenen satırlarda.
alter table charges add constraint charges_total_from_line
  check (total_minor = unit_price_minor * quantity or source = 'package_refund') not valid;

drop table if exists discounts;
drop function if exists discounts_bump_version();
drop type if exists discount_kind;
drop type if exists discount_scope;

-- ---------------------------------------------------------------------------
-- 5. Paket iadesinin parasal mutabakatı (0024)
-- ---------------------------------------------------------------------------
-- İade artık yalnız seans iadesi; tutar bilgi amaçlı `refund_amount_minor`da
-- kalıyor. "Ödendi mi" durumunu kapatan kasa modülü olmadığı için sütun
-- sonsuza dek `pending` kalırdı.
alter table customer_packages drop constraint if exists customer_packages_refund_fields;
alter table customer_packages drop column if exists refund_settlement_status;
drop type if exists package_refund_settlement;

-- ---------------------------------------------------------------------------
-- 6. İzinler ve muhasebe rolü
-- ---------------------------------------------------------------------------
delete from permissions where key in (
  'finance.payment:read',
  'finance.payment:write',
  'finance.commission:read',
  'finance.commission:write',
  'finance.price:override'
);

-- Muhasebe üyelikleri ve bekleyen davetler: `role_key` FK'sı `on delete`
-- tanımlamıyor, rol satırı ancak onlar gidince silinebilir. Kullanıcı
-- hesapları duruyor; yalnız bu kiracıdaki rol ataması düşüyor.
delete from invitations where role_key = 'accountant';
delete from memberships where role_key = 'accountant';
delete from roles where key = 'accountant';
