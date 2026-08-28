-- Batch 5.4 — paket raporlarının indeksleri.
--
-- Yeni tablo YOK ve materialized view de YOK. Üç gerekçe, üçüncüsü belirleyici:
--   1. 10k paket ≈ 30–50k kalem; aşağıdaki kapsayıcı kısmi indeksle sorgu
--      p95 < 500 ms hedefinin çok altında kalıyor.
--   2. Matview kiracı başına refresh takvimi ister; cron sayısı kiracı
--      sayısıyla büyür.
--   3. Matview RLS'e UYMAZ — view sahibinin haklarıyla dolar ve uygulama rolü
--      ona select yaptığında current_tenant_id() filtresi devrede olmaz. Para
--      raporunda kiracılar arası sızıntı, yavaş rapordan kıyaslanamayacak
--      kadar kötü bir hatadır.

-- Yükümlülük raporu yalnız AÇIK kalemleri gezer; ihtiyacı olan tüm kolonlar
-- indekste, tabloya hiç dönmeden.
create index customer_package_items_open_idx
  on customer_package_items (tenant_id, service_id)
  include (customer_package_id, quantity_total, remaining_sessions, item_total_minor)
  where remaining_sessions > 0;

create index customer_packages_expiry_idx
  on customer_packages (tenant_id, expires_at)
  where status = 'active'::customer_package_status
    and deleted_at is null
    and expires_at is not null;
