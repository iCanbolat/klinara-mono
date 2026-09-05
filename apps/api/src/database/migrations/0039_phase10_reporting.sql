-- Batch 10.1 — Raporlar.
--
-- MATERIALIZED VIEW YOK, ve bu bilinçli bir sapma: batch tanımı "materialized
-- view + cron yenileme" diyordu, ama 0026 matview'ü gerekçesiyle reddetmişti —
-- matview RLS'e UYMAZ, sahibinin haklarıyla dolar ve Postgres'te matview'in
-- `security_invoker` karşılığı yoktur. 0027'deki `customer_account_entries`
-- view'ı yalnız o bayrak sayesinde güvenli. Para raporunda kiracılar arası
-- sızıntı, yavaş rapordan kıyaslanamayacak kadar kötü bir hatadır.
--
-- Bunun yerine `report_snapshots` GERÇEK BİR TABLO: `tenant_id` taşır, RLS
-- `enable` + `force` açıktır ve yenileme kiracı başına `runForTenant` altında
-- koşar. Yani snapshot yolu, canlı sorgu yoluyla tam olarak aynı izolasyon
-- garantisinin altındadır.

-- ---------------------------------------------------------------------------
-- Rapor özetleri — günlük tanecikli, yeniden hesaplanabilir
-- ---------------------------------------------------------------------------
-- Bu tablo TÜRETİLMİŞ veridir: her satırı kaynak tablolardan yeniden üretmek
-- mümkündür ve gece işi bunu son 35 gün için zaten yapar. İki sonucu var:
-- denetim trigger'ı BAĞLANMAZ (kaynak tabloların kendi izi var, buradaki bir
-- değişiklik bir olay değil bir yeniden hesap) ve `delete` uygulama rolüne
-- açıktır (yeniden hesap bir günü komple silip yazabilmeli).
create table report_snapshots (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- Hangi rapor. Yalnız AĞIR olan ikisi snapshot'lanır; no-show, retention ve
  -- personel performansı canlı sorguda kalır (pencereleri küçük, kırılımları
  -- hafif). Yeni bir rapor eklenecekse check'e de eklenmeli — sessizce
  -- tanınmayan bir `report_name` biriktirmek, okunmayan satır demektir.
  report_name text not null check (report_name in ('occupancy', 'revenue')),

  branch_id uuid not null references branches(id) on delete cascade,

  -- ŞUBE YEREL GÜNÜ. `timestamptz` değil `date`: "1 Eylül'ün doluluğu" sorusu
  -- şubenin takviminde sorulur ve yaz saati geçişinde 23 ya da 25 saatlik bir
  -- günün de tek bir kovası olmalıdır.
  bucket_date date not null,

  -- Kırılım. `group_id` NULL olabilir (şube toplamı gibi kimliksiz kırılımlar)
  -- ve tekillik indeksi bunu `coalesce` ile ele alıyor.
  group_kind  text not null check (group_kind in ('total', 'staff', 'service', 'package', 'source')),
  group_id    uuid,
  group_label text not null,

  -- Ölçüler. Rapor başına şekli farklı olduğu için jsonb: `occupancy` için
  -- `{bookedMinutes, availableMinutes}`, `revenue` için
  -- `{accruedMinor, collectedMinor, refundedMinor, appointments}`.
  --
  -- Para HER ZAMAN minor unit TAMSAYISIDIR. jsonb `numeric` taşıyabildiği için
  -- bu kural veritabanında zorlanamıyor; yazan tek yol `snapshot.service.ts` ve
  -- oradaki tipler tamsayı. Okuma tarafı da `::bigint` ile çıkarıyor, yani bir
  -- ondalık buraya girse bile rapora sızmadan patlar.
  metrics jsonb not null,

  -- Bu satırın hangi anda hesaplandığı. Bayatlığı kullanıcıya söyleyebilmek
  -- için lazım; `updated_at` yeniden yazımı, bu ise hesabın kendisini anlatır.
  computed_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint report_snapshots_metrics_object check (jsonb_typeof(metrics) = 'object'),
  -- Toplam satırının kimliği olmaz. Diğer kırılımlarda `group_id` NULL
  -- OLABİLİR (`source` bir enum değeri, uuid değil) — bu yüzden ters yön
  -- zorlanmıyor.
  constraint report_snapshots_group_id_shape check (
    group_kind <> 'total' or group_id is null
  )
);

-- Yeniden hesap `on conflict do update` ile idempotent olmalı; `group_id`
-- NULL olabildiği için sade bir unique index yetmez (NULL'lar birbirine eşit
-- sayılmaz ve aynı kova iki kez yazılabilirdi).
create unique index report_snapshots_bucket_key
  on report_snapshots (
    tenant_id, report_name, branch_id, bucket_date, group_kind,
    coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Okuma yolu: bir rapor tek bir aralığı, tek bir kırılımla tarar.
create index report_snapshots_read_idx
  on report_snapshots (tenant_id, report_name, branch_id, bucket_date)
  include (group_kind, group_id, group_label, metrics);

alter table report_snapshots enable row level security;
alter table report_snapshots force row level security;
create policy report_snapshots_isolation on report_snapshots
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger report_snapshots_set_updated_at
  before update on report_snapshots for each row execute function set_updated_at();

grant select, insert, update, delete on report_snapshots to klinara_app;

-- ---------------------------------------------------------------------------
-- 10.1 izni — uygulayıcının KENDİ performansı
-- ---------------------------------------------------------------------------
-- `report.revenue:read` üzerine binmez ve onun dar bir hâli değildir: tek
-- başına hiçbir şubenin cirosunu açmaz. Daraltmayı sunucu yapar; principal
-- `staff_profiles.user_id` üzerinden çözülür ve sorgu zorla kendi
-- `staff_profile_id`'sine kilitlenir.
insert into permissions (key, description) values
  ('report.performance:read.own', 'Yalnız kendi performans raporunu görüntüleme')
on conflict (key) do update set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',        'report.performance:read.own'),
  ('practitioner', 'report.performance:read.own')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Sıcak yol index'leri
-- ---------------------------------------------------------------------------
-- 0026'nın kapsayıcı-index kalıbı: rapor sorgusu heap'e hiç inmesin.

-- No-show / iptal oranı ve doluluk paydası: şube × durum × zaman.
create index appointments_report_status_idx
  on appointments (tenant_id, branch_id, status, starts_at)
  where deleted_at is null;

-- Personel performansı ve ciro-personel kırılımı: satır grain'i BURADA
-- (`appointments.staff_profile_id` diye bir kolon yok).
create index appointment_services_report_idx
  on appointment_services (tenant_id, starts_at)
  include (staff_profile_id, service_id, appointment_id, price_minor);

-- Ciro tahakkuku: `charges_branch_time_idx` var ama toplamı okumak için heap'e
-- iniyor. Kapsayıcı sürüm tahakkuk sorgusunu index-only yapıyor.
create index charges_report_idx
  on charges (tenant_id, branch_id, created_at)
  include (source, status, total_minor, net_minor, vat_minor,
           appointment_service_id, customer_package_id);
