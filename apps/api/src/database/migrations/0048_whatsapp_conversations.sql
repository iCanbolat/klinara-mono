-- WhatsApp sohbetleri — resepsiyonun müşteriyle yazıştığı ekran.
--
-- Sohbet bir NUMARAYA bağlı, müşteriye değil: kliniğe kayıtlı olmayan bir
-- numara da yazabilir ve o mesaj düşürülemez. Müşteri kaydı varsa (ya da
-- sonradan bağlanırsa) `customer_id` dolar.
--
-- Mesajların kendisi YENİ bir tabloya kopyalanmıyor: gelenler zaten
-- `inbound_messages`ta, gidenler `message_log`da. İkisine `conversation_id`
-- ekleniyor ve akış ikisinin birleşimi olarak okunuyor — aynı mesajı iki
-- yerde tutmak, teslim durumunun birinde güncellenip ötekinde eski kalması
-- demekti.

-- Resepsiyonun elle yazdığı cevap da bir bildirimdir ve `message_log`da
-- izlenebilir olmalı ("müşteriye kim, ne yazdı?").
alter type notification_event add value 'staff_reply';

create type conversation_status as enum ('open', 'closed');

create table conversations (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  -- E.164; webhook ve gönderim aynı normalizasyondan geçiyor.
  phone                 text not null,
  customer_id           uuid references customers(id) on delete set null,
  status                conversation_status not null default 'open',
  last_message_at       timestamptz not null default now(),
  last_message_preview  text,
  -- 'in' | 'out' — liste satırında "siz: …" öneki için.
  last_message_direction text,
  -- 24 saatlik pencere buradan okunur; `whatsapp_contact_windows` gönderim
  -- tarafının kaynağı olarak kalıyor.
  last_inbound_at       timestamptz,
  last_read_at          timestamptz,
  closed_at             timestamptz,
  closed_by             uuid references users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index conversations_phone_key on conversations (tenant_id, phone);
create index conversations_list_idx on conversations (tenant_id, status, last_message_at desc, id);

alter table inbound_messages
  add column conversation_id uuid references conversations(id) on delete set null;
create index inbound_messages_conversation_idx on inbound_messages (conversation_id, received_at);

alter table message_log
  add column conversation_id uuid references conversations(id) on delete set null,
  -- Hatırlatmanın Onayla/İptal butonları token'ı gönderim anında üretiyor ve
  -- hangi randevuya ait olduğunu buradan biliyor. Sohbet ekranı da mesajın
  -- hangi randevu hakkında olduğunu buradan gösteriyor.
  add column appointment_id uuid references appointments(id) on delete set null,
  add column sent_by_user_id uuid references users(id) on delete set null;
create index message_log_conversation_idx on message_log (conversation_id, created_at)
  where conversation_id is not null;
create index message_log_customer_whatsapp_idx on message_log (customer_id, created_at)
  where channel = 'whatsapp';

alter table conversations enable row level security;
alter table conversations force row level security;
create policy conversations_isolation on conversations
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on conversations to klinara_app;
-- Sohbet kaydı SİLİNMEZ: kapatılır.
revoke delete on conversations from klinara_app;
