-- Uygulama rolü.
--
-- İki rol ayrımı bu mimarinin temelidir:
--   klinara_owner : migration'ları koşar, tabloların sahibidir, RLS'i bypass eder.
--   klinara_app   : API'nin bağlandığı rol. NOBYPASSRLS — kiracı izolasyonunu
--                   atlayamaz. Uygulama kodunda tenant_id filtresi unutulsa bile
--                   veritabanı satır döndürmez.
--
-- Rol burada ŞİFRESİZ ve NOLOGIN olarak oluşturulur; kimlik bilgisi ortama göre
-- ayrıca atanır (`alter role klinara_app login password '...'`). Böylece parola
-- migration dosyasında ve sürüm geçmişinde yer almaz.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'klinara_app') then
    create role klinara_app nologin nobypassrls;
  end if;
end $$;

grant usage on schema public to klinara_app;

-- Bundan sonra oluşturulacak tablolarda otomatik yetki.
alter default privileges in schema public
  grant select, insert, update, delete on tables to klinara_app;
alter default privileges in schema public
  grant usage, select on sequences to klinara_app;

-- Migration tablosu runner tarafından (bu dosyadan önce) oluşturulur, dolayısıyla
-- default privileges kapsamına girmez; açıkça yetki veriyoruz. `/readyz` ucu
-- uygulanmış migration sürümünü buradan okur.
grant select on _klinara_migrations to klinara_app;
