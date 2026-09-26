-- Ürün pazarlama iletisi göndermez; müşteriyle SMS'ten yazışmaz.
--
-- Klinik müşterisine yalnız İŞLEMSEL ileti gider (randevu onayı, hatırlatma,
-- iptal, paket bilgisi) ve tek kanal WhatsApp. Bu migration iki kavramı
-- kaldırıyor:
--
--   * Pazarlama: doğum günü olayı, işlemsel/pazarlama ayrımı (`kind`) ve
--     ticari ileti reddi kayıtları (`contact_opt_outs`). Ayrım tek bir
--     pazarlama olayı için vardı; o olay gidince her ileti işlemsel ve
--     reddin engelleyeceği bir şey kalmıyor.
--   * SMS: müşteri bildirim kanalı olarak. `booking_otp_channel` ve telefon
--     doğrulaması DOKUNULMAZ — onlar kimlik doğrulama akışı, bildirim değil.
--
-- Enum DEĞERLERİ ('birthday', 'sms') düşürülmez: Postgres enum'dan değer
-- silmeyi desteklemiyor ve `message_log` geçmişte gerçekten yazılmış satırları
-- taşıyor. Uygulama bu değerleri artık üretmiyor.

-- --- Ticari ileti reddi ----------------------------------------------------
-- Tablo ile birlikte RLS politikası, audit ve updated_at trigger'ları düşer.
drop table contact_opt_outs;
drop type opt_out_source;

-- --- İşlemsel / pazarlama ayrımı ------------------------------------------
alter table message_log drop column kind;
drop type notification_kind;

-- --- Doğum günü ------------------------------------------------------------
delete from notification_preferences where event = 'birthday';
delete from notification_templates where event = 'birthday';

-- Kuyrukta bekleyen doğum günü iletisi GÖNDERİLMEZ; satır iz olarak kalır.
update message_log
set status = 'skipped', error_detail = 'Pazarlama iletisi kaldırıldı', updated_at = now()
where event = 'birthday' and status in ('queued', 'sending');

-- --- SMS -------------------------------------------------------------------
-- Tercih listelerinden SMS çıkar (0046'daki e-posta adımının aynısı).
update notification_preferences
set channels = array_remove(channels, 'sms'::notification_channel)::notification_channel[]
where 'sms'::notification_channel = any (channels);

-- SMS tek kanaldıysa liste boşaldı: boş dizi "olay kapalı" demek, oysa kiracı
-- olayı kapatmadı — yalnız kanal elinden alındı.
update notification_preferences
set channels = array['whatsapp']::notification_channel[]
where event <> 'staff_internal' and cardinality(channels) = 0;

-- SMS şablonları pasife alınır, SİLİNMEZ: metni kimin ne zaman yazdığı bir
-- destek kaydıdır (0046'daki e-posta şablonlarıyla aynı gerekçe).
update notification_templates
set is_active = false, updated_at = now()
where channel = 'sms';

-- Kuyrukta bekleyen SMS iletisi artık gönderilemez; satır iz olarak kalır.
update message_log
set status = 'skipped', error_detail = 'SMS kanalı kaldırıldı', updated_at = now()
where channel = 'sms' and status in ('queued', 'sending');
