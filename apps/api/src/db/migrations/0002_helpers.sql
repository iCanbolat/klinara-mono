-- Kiracı context'ini okuyan yardımcılar.
--
-- DİKKAT: `current_setting(...)::uuid` DOĞRUDAN kullanılmaz. Bir GUC
-- `set_config(..., true)` ile bir kez yazıldıktan sonra transaction bitiminde
-- NULL'a değil BOŞ STRING'e döner; `''::uuid` ise hata fırlatır. Bu durumda
-- kiracı context'ini set etmeyi unutan her kod yolu temiz bir "kayıt yok"
-- yerine anlamsız bir 500 üretir. `nullif` ile NULL'a çeviriyoruz: karşılaştırma
-- NULL olur, satır dönmez — sessizce kapalı (fail-closed).
create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function current_actor_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function current_request_id() returns text
language sql stable as $$
  select nullif(current_setting('app.request_id', true), '')
$$;

-- Append-only tablolarda UPDATE/DELETE'i engelleyen trigger fonksiyonu.
-- Paket defteri ve onam kayıtları gibi "kanıt" niteliğindeki tablolarda kullanılır.
create or replace function reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Bu tablodaki kayıtlar değiştirilemez veya silinemez (%).', tg_table_name
    using errcode = 'restrict_violation';
end $$;

-- `updated_at` kolonunu otomatik güncelleyen trigger fonksiyonu.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
