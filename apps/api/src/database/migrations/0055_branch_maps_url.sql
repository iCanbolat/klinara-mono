-- Şubenin Google Maps bağlantısı.
--
-- Randevu mesajlarında (`branchMapsUrl` şablon değişkeni) klinik konumu olarak
-- kullanılır. Adres (`address`) zaten var; bağlantı ayrı tutulur çünkü adres
-- metni serbest, bağlantı tıklanabilir bir URL. Yalnız https kabul edilir:
-- bağlantı müşteriye giden mesaja yazılıyor.
alter table branches add column maps_url text;
alter table branches
  add constraint branches_maps_url_https check (maps_url is null or maps_url ~* '^https://');
