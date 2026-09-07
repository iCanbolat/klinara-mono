-- ---------------------------------------------------------------------------
-- Batch 10.2 — planlayıcı ayarı ve ölçüm altyapısı
-- ---------------------------------------------------------------------------
-- Bu migration TABLO YARATMIYOR. İçeriği tamamen, ölçüm sırasında bulunan tek
-- bir yanlış varsayımın düzeltilmesi ve o ölçümü tekrarlanabilir kılan
-- uzantının kurulmasıdır.

-- ---------------------------------------------------------------------------
-- random_page_cost — bulunmuş GERÇEK bir hata
-- ---------------------------------------------------------------------------
-- PostgreSQL'in varsayılanı 4.0'dır ve DÖNEN DİSK varsayar: rastgele bir
-- sayfa okumak, sıralı okumaktan dört kat pahalıdır. SSD'de bu oran ~1'dir.
-- Varsayılan bırakıldığında planlayıcı index taramasını sistematik olarak
-- fazla pahalı sanır ve seq scan'e kaçar.
--
-- 100k randevu / 20k müşteri hacminde ÖLÇÜLEN etki (takvim haftalık sorgusu,
-- RLS altında, `klinara_app` rolüyle):
--
--   random_page_cost = 4.0  →  Seq Scan on customers (20.000 satır)  13.3 ms
--   random_page_cost = 1.1  →  Index Scan customers_pkey (448 arama)  5.3 ms
--
-- Yalnız 2.5 kat hız değil: seq scan KİRACININ MÜŞTERİ SAYISIYLA büyüyordu,
-- index taraması SONUÇ KÜMESİYLE büyüyor. 200k müşterili bir kiracıda ilki
-- ~95 ms'ye çıkardı, ikincisi yerinde kalır. Hedefin (150 ms) altında kalmak
-- yetmez; ölçekle büyümeyen plan seçilmelidir.
--
-- Ayar VERİTABANI seviyesinde: `postgresql.conf`a yazmak yerine burada
-- durması, üretim ve CI dahil migration'ların koştuğu her yerde aynı planın
-- seçilmesini garanti ediyor ve sürüm kontrolünde görünür kılıyor. Dönen disk
-- üzerinde koşan bir kurulum bunu ezmek isterse `alter database` ile geri
-- alabilir — ama o bilinçli bir karar olmalı, sessiz bir varsayım değil.
do $$
begin
  execute format('alter database %I set random_page_cost = 1.1', current_database());
end $$;

-- `effective_cache_size` planlayıcıya "işletim sistemi önbelleğiyle birlikte
-- ne kadar bellek var" der; varsayılanı 4 GB'tır ve düşük kaldığında index
-- taraması yine cezalandırılır. Muhafazakâr bir değer; gerçek sunucuda
-- belleğin ~%75'i olmalı (10.4 runbook).
do $$
begin
  execute format('alter database %I set effective_cache_size = ''4GB''', current_database());
end $$;

-- ---------------------------------------------------------------------------
-- pg_stat_statements
-- ---------------------------------------------------------------------------
-- "En pahalı sorgular" listesinin kaynağı. Uzantı YALNIZ sunucu onu
-- önyüklediyse kurulabilir (`shared_preload_libraries`); yerelde bunu
-- `docker-compose.yml` yapıyor, üretimde runbook.
--
-- Önyükleme yoksa migration PATLAMAMALI: ölçüm aracının yokluğu, uygulamanın
-- açılmamasına sebep olamaz. Bu yüzden koşullu.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_stat_statements') then
    begin
      create extension if not exists pg_stat_statements;
    exception when others then
      raise notice 'pg_stat_statements kurulamadı (shared_preload_libraries eksik olabilir): %',
        sqlerrm;
    end;
  else
    raise notice 'pg_stat_statements bu sunucuda mevcut değil; ölçüm uzantısı atlandı';
  end if;
end $$;
