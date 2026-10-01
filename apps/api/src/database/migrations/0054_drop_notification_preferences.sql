-- Bildirim tercihleri kaldırıldı: kanal önceliği ve sessiz saat.
--
-- Klinik müşterisiyle tek kanal WhatsApp üzerinden yazışıyor; öncelik sırası
-- anlamsız. Sessiz saat de kalktı: planlı mesajlar (hatırlatma, gelmedi
-- takibi, paket bakiyesi) planlandığı anda gider. Dispatcher kanalı olayın
-- kod içindeki varsayılanından alıyor.
--
-- Tablo ile birlikte RLS politikası, audit ve updated_at trigger'ları ve
-- indeksler düşer. Geri alınamaz: kayıtlı tercih satırları silinir.
drop table notification_preferences;
