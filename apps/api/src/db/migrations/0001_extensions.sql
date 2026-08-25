-- Uzantılar. Hepsi mimarinin çekirdek parçalarıdır:
--   btree_gist : EXCLUDE constraint'lerinde uuid (=) ile tstzrange (&&) birlikte
--                kullanılabilsin diye — çakışma engellemenin temeli.
--   pgcrypto   : gen_random_uuid() ve alan bazlı şifreleme yardımcıları.
--   citext     : e-posta gibi büyük/küçük harf duyarsız tekillik alanları.
--   pg_trgm    : müşteri adı/telefon üzerinde benzerlik araması.
create extension if not exists btree_gist;
create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;
