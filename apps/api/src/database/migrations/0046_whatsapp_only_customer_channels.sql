-- Klinik müşterisiyle yalnız WhatsApp üzerinden yazışır: e-posta kanalı
-- müşteriye bakan her yoldan çıkıyor. `staff_internal` personele giden iç
-- bildirimdir ve dokunulmuyor.
--
-- `notification_channel` enum'undan 'email' DÜŞÜRÜLMEZ: `staff_internal` onu
-- kullanıyor ve `message_log` geçmişte gerçekten gönderilmiş e-postaları
-- taşıyor. Değişen, kanalın müşteri olaylarında geçerli sayılıp sayılmadığı.

-- Tercih listelerinden e-postayı çıkar. `array_remove` metin dizisi ürettiği
-- için sonuç enum dizisine geri çevrilir.
update notification_preferences
set channels = array_remove(channels, 'email'::notification_channel)::notification_channel[]
where event <> 'staff_internal' and 'email'::notification_channel = any (channels);

-- E-posta tek kanaldı ve liste boşaldıysa: boş dizi "olay kapalı" demek, oysa
-- kiracı olayı kapatmadı — yalnız kanalı elinden alındı.
update notification_preferences
set channels = array['whatsapp']::notification_channel[]
where event <> 'staff_internal' and cardinality(channels) = 0;

-- Müşteri olaylarının e-posta şablonları pasife alınır, SİLİNMEZ: metni kimin
-- ne zaman yazdığı bir destek kaydıdır.
update notification_templates
set is_active = false, updated_at = now()
where channel = 'email' and event <> 'staff_internal';

-- `message_log` satırlarına DOKUNULMAZ: geçmişte gerçekten gönderilmiş
-- e-postalar mesaj günlüğünde görünmeye devam etmeli.
