-- Şablon gövdesi yansımaya ekleniyor.
--
-- Sohbet ekranı pencere kapalıyken onaylı bir şablon gönderebiliyor;
-- resepsiyon göndermeden önce metni görmeli ve kayıtta (`message_log`)
-- müşteriye giden GERÇEK metin durmalı. Metin Meta'dan senkronizasyonda
-- okunur; eski satırlar bir sonraki doğrulama/provision'da dolar.
alter table whatsapp_templates add column body_text text;
