-- Randevu durum akışının sadeleşmesi.
--
-- 1. `in_progress` ("İşlemde") akıştan çıkıyor: Planlandı → Geldi → Tamamlandı.
--    Ara adım bir şey taşımıyordu — onam kontrolü `completed`e geçerken de
--    yapılıyor, paket tüketimi ve borç zaten yalnız `completed`te doğuyor.
--    Personel yalnız bir düğmeye fazladan basıyordu.
--
--    Enum değeri DÜŞÜRÜLMÜYOR (Postgres enum'dan değer silinemez; geçmiş
--    `appointment_history.from_status/to_status` satırları onu taşıyor).
--    Uygulama artık üretmiyor; geçiş tablosu ona giden yolu kapatıyor.
--
-- 2. Tamamlanmış randevuyu geri açmanın hedefi `arrived` oluyor (eskiden
--    `in_progress`). İzin aynı: `appointment:reopen`.
--
-- 3. `confirmed → scheduled`: personel onaylanmış bir randevuyu başka saate
--    aldığında müşterinin onayı ESKİ saate aitti; randevu yeni saat için
--    yeniden onay bekler (`AppointmentsService.rescheduleInternal`).
--
-- 4. `appointment_rescheduled` bildirim olayı: personel saati değiştirince
--    müşteriye WhatsApp gider (`klinara_randevu_ertelendi`).

alter type notification_event add value if not exists 'appointment_rescheduled';

delete from appointment_status_transitions
 where from_status = 'in_progress' or to_status = 'in_progress';

insert into appointment_status_transitions (from_status, to_status, required_permission) values
  ('arrived',   'completed', null),
  ('completed', 'arrived',   'appointment:reopen'),
  ('confirmed', 'scheduled', null)
on conflict (from_status, to_status) do nothing;

-- Süren `in_progress` randevular `arrived`a iner. Geçiş tablosunda artık bu
-- yol yok; trigger bu tek güncelleme için kapatılıyor. Sürüm sayacı yine
-- artar (ayrı trigger), açık bir düzenleme ekranı ETag çatışması görür.
alter table appointments disable trigger appointments_status_check;
update appointments set status = 'arrived' where status = 'in_progress';
alter table appointments enable trigger appointments_status_check;
