-- Faz 10.3 — Dağıtık hız sınırı (PostgreSQL tabanlı token bucket).
--
-- Bugüne kadarki sayaç SÜREÇ İÇİDİR (`@nestjs/throttler`ın varsayılan
-- `Map`'i). Tek instance'ta doğru çalışır; iki instance'ta sınır İKİYE KATLANIR
-- ve giriş ucundaki "dakikada 10 deneme" fiilen 20 olur. Faz 9 public uçları
-- açtığı ve Faz 12 yeni yazma yüzeyi eklediği için bu, yatay ölçeğe geçmeden
-- kapatılması gereken bir yayın ön koşuludur (bkz. bölüm 11 risk tablosu).
--
-- NEDEN REDIS DEĞİL: yığında Redis YOK ve bu bilinçli bir karar (bkz. bölüm 2).
-- Hız sınırı sayacı, kuyruk (pg-boss) ve idempotency ile aynı sınıfta: küçük,
-- sık yazılan, kaybı tolere edilebilir bir durum. PostgreSQL bunu satır kilidi
-- ile zaten atomik yapabiliyor; ikinci bir altyapı bileşeni işletme maliyeti
-- getirir, dayanıklılık getirmez.
--
-- NEDEN KİRACI TABLOSU DEĞİL: anahtar bir IP veya kullanıcı+rota çiftidir,
-- kiracı verisi değildir. `tenant_id` ve RLS eklemek burada koruma sağlamaz;
-- sayaç zaten hiçbir uçtan okunmuyor. Tablo `pg-boss` şeması gibi ALTYAPI
-- tablosudur.
create table rate_limit_counters (
  bucket_key     text primary key,
  hits           integer     not null default 0,
  -- Sabit pencerenin bitişi. Pencere DOLDUĞUNDA sıfırlanır; kayan pencere
  -- değildir — `@nestjs/throttler`ın süreç-içi sayacı da böyle davranır ve
  -- iki depolamanın davranışının aynı kalması testleri anlamlı kılar.
  window_ends_at timestamptz not null,
  -- Sınır aşıldığında ceza penceresi. `blockDuration` verilmezse throttler
  -- bunu `ttl` ile aynı yapar.
  blocked_until  timestamptz,
  updated_at     timestamptz not null default now()
);

-- Süresi geçmiş satırların temizliği için (bakım işi periyodik siler).
create index rate_limit_counters_window_idx on rate_limit_counters (window_ends_at);

/**
 * Bir isteği sayar ve sınır durumunu döner — TEK sorguda, atomik.
 *
 * Atomiklik satır kilidinden gelir (`for update`): iki instance aynı anahtara
 * aynı anda vurduğunda ikincisi birincinin yazdığını görür. "Oku, artır, yaz"
 * üç ayrı sorgu olsaydı ikisi de aynı sayıyı okur ve sınır sessizce ikiye
 * katlanırdı — düzeltmeye çalıştığımız hatanın aynısı.
 *
 * Dönen alanlar `ThrottlerStorageRecord` ile BİREBİR aynı anlamdadır; süreler
 * SANİYEdir çünkü `@nestjs/throttler` `Retry-After` başlığını öyle yazar.
 */
create function rate_limit_hit(
  p_key      text,
  p_ttl_ms   bigint,
  p_limit    integer,
  p_block_ms bigint
) returns table (
  total_hits           integer,
  time_to_expire       integer,
  is_blocked           boolean,
  time_to_block_expire integer
)
language plpgsql
as $$
declare
  -- `now()` transaction başlangıcını verir; sayaç için gerçek duvar saati
  -- gerekiyor, aksi hâlde uzun bir transaction penceresi kaydırırdı.
  v_now     timestamptz := clock_timestamp();
  v_ttl     interval    := make_interval(secs => p_ttl_ms / 1000.0);
  v_block   interval    := make_interval(secs => p_block_ms / 1000.0);
  v_counter rate_limit_counters%rowtype;
begin
  insert into rate_limit_counters (bucket_key, hits, window_ends_at)
  values (p_key, 0, v_now + v_ttl)
  on conflict (bucket_key) do nothing;

  select * into v_counter
    from rate_limit_counters
   where bucket_key = p_key
     for update;

  -- Yarış: satır iki istek arasında bakım işi tarafından silinmiş olabilir.
  if not found then
    insert into rate_limit_counters (bucket_key, hits, window_ends_at)
    values (p_key, 0, v_now + v_ttl)
    returning * into v_counter;
  end if;

  if v_counter.window_ends_at <= v_now then
    v_counter.hits := 0;
    v_counter.window_ends_at := v_now + v_ttl;
  end if;

  if v_counter.blocked_until is not null and v_counter.blocked_until <= v_now then
    v_counter.blocked_until := null;
    v_counter.hits := 0;
  end if;

  -- Blok süresince sayaç ARTMAZ: ceza penceresi, isteği sürekli tekrarlayan
  -- bir istemcinin cezayı sonsuza uzatmasına yol açmamalı.
  if v_counter.blocked_until is null then
    v_counter.hits := v_counter.hits + 1;
    if v_counter.hits > p_limit then
      v_counter.blocked_until := v_now + v_block;
    end if;
  end if;

  update rate_limit_counters
     set hits           = v_counter.hits,
         window_ends_at = v_counter.window_ends_at,
         blocked_until  = v_counter.blocked_until,
         updated_at     = v_now
   where bucket_key = p_key;

  total_hits := v_counter.hits;
  time_to_expire := greatest(
    ceil(extract(epoch from (v_counter.window_ends_at - v_now)))::integer, 0
  );
  is_blocked := v_counter.blocked_until is not null;
  time_to_block_expire := case
    when v_counter.blocked_until is null then 0
    else greatest(ceil(extract(epoch from (v_counter.blocked_until - v_now)))::integer, 0)
  end;
  return next;
end;
$$;

grant select, insert, update, delete on rate_limit_counters to klinara_app;
grant execute on function rate_limit_hit(text, bigint, integer, bigint) to klinara_app;
