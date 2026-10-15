-- Abonelik planı ve kapasite limitleri.
--
-- Planlar yalnız kapasitede ayrışır (şube, hekim/uygulayıcı); tanımları
-- `packages/shared/src/plans.ts`te. Ödeme altyapısı yok: planı platform
-- yöneticisi atar. Override'lar planın limitini kiracıya özel ezer
-- (`ozel` planı ve pazarlıklı müşteriler için).
--
-- Mevcut kiracılar `klinik` planına geçer. Limiti aşan bir kiracı varsa
-- mevcut şube ve hekimler çalışmaya devam eder; yalnız YENİ ekleme engellenir.

alter table tenants
  add column plan_key text not null default 'klinik'
    check (plan_key in ('baslangic', 'klinik', 'cok-subeli', 'ozel')),
  add column max_branches_override integer check (max_branches_override is null or max_branches_override >= 1),
  add column max_practitioners_override integer check (max_practitioners_override is null or max_practitioners_override >= 1),
  add column plan_note text;

-- Plan ve durum YALNIZ platform yöneticisi tarafından değiştirilebilir.
-- `tenants_isolation` politikası kiracının kendi satırını güncellemesine izin
-- veriyor (ad, saat dilimi); bu trigger plan/durum kolonlarını o yoldan kapatır.
-- Uygulama katmanı zaten bu alanları kiracı ucunda kabul etmiyor; trigger
-- ikinci bir kilit — bir hata ya da yeni bir uç kiracıya kendi planını
-- yükseltme imkânı vermesin.
create or replace function tenants_plan_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.platform_admin', true), 'off') = 'on' then
    return new;
  end if;
  if new.plan_key is distinct from old.plan_key
     or new.max_branches_override is distinct from old.max_branches_override
     or new.max_practitioners_override is distinct from old.max_practitioners_override
     or new.plan_note is distinct from old.plan_note
     or new.status is distinct from old.status then
    raise exception 'plan ve durum yalnız platform yöneticisi tarafından değiştirilebilir'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger tenants_plan_guard
  before update on tenants
  for each row execute function tenants_plan_guard();
