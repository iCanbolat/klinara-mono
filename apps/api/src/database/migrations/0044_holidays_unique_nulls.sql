-- ---------------------------------------------------------------------------
-- Tatillerde KİRACI GENELİ tekilliği
-- ---------------------------------------------------------------------------
-- `holidays_tenant_branch_date_key` 0015'te `(tenant_id, branch_id,
-- holiday_date)` üzerine kuruldu ama `nulls not distinct` OLMADAN. PostgreSQL
-- varsayılanında iki NULL birbirinden FARKLI sayılır; yani kiracı geneli
-- (`branch_id is null`) aynı güne SINIRSIZ kayıt yazılabiliyordu.
--
-- Tablo yalnız seed'den doluyorken görünmeyen bir açıktı: seed her tatili bir
-- kez yazıyor. Tatil yönetimi ucu (Faz 3'ten devreden madde) açılınca kural
-- gerçek oldu — "1 Ocak" iki kez tanımlanabilir ve uygunluk motorunun
-- `order by branch_id nulls last ... limit 1` seçimi ikisinden hangisinin
-- uygulanacağını SESSİZCE, satır sırasına göre belirlerdi.
--
-- `memberships_unique` aynı gerekçeyle 0006'da `nulls not distinct` kullanıyor;
-- bu migration tatilleri o kuralla hizalıyor.

-- Var olan yinelenmiş kiracı geneli satırlar ÖNCE temizlenir: en eskisi kalır
-- (motorun bugün fiilen uyguladığı satır o değil, ama "hangisi kaldı" sorusuna
-- tarihe göre deterministik bir cevap veriyoruz).
update holidays h
   set deleted_at = now()
 where h.deleted_at is null
   and exists (
     select 1
       from holidays other
      where other.deleted_at is null
        and other.tenant_id = h.tenant_id
        and other.holiday_date = h.holiday_date
        and other.branch_id is not distinct from h.branch_id
        and (other.created_at, other.id) < (h.created_at, h.id)
   );

drop index if exists holidays_tenant_branch_date_key;

create unique index holidays_tenant_branch_date_key
  on holidays (tenant_id, branch_id, holiday_date)
  nulls not distinct
  where deleted_at is null;
