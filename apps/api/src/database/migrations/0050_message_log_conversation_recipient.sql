-- Kayıtlı olmayan numaraya sohbetten giden mesaj.
--
-- 0031'deki kısıt her satırda ALICININ ya müşteri ya kullanıcı olmasını
-- istiyordu. Sohbet ekranı (0048) müşteri kaydı olmayan bir numaraya da cevap
-- yazabiliyor; o satırın alıcısı `conversation_id` üzerinden sohbetin
-- numarası. Kısıt bu üçüncü biçimi de kabul edecek şekilde genişletiliyor —
-- müşteri ve kullanıcının İKİSİNİN BİRDEN dolu olması hâlâ yasak.
alter table message_log drop constraint message_log_recipient_ck;
alter table message_log add constraint message_log_recipient_ck check (
  (customer_id is not null and user_id is null) or
  (customer_id is null and user_id is not null) or
  (customer_id is null and user_id is null and conversation_id is not null)
);
