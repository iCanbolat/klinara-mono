-- Batch 8.3 — gelen webhook: teslim durumu ve buton yanıtı.
--
-- Bu batch'in en kritik ayrıntısı ŞEMADA DEĞİL, uygulamada: `X-Hub-Signature-256`
-- gövdenin HAM BAYTLARI üzerinden doğrulanır. JSON parse edilip yeniden
-- serialize edilmiş bir gövde imzayı bozar (mimari karar 4.6).
--
-- Şemanın taşıdığı iki garanti:
--   1. İDEMPOTENCY VERİDEN gelir: `(provider, event_id)` tekildir. Meta aynı
--      olayı tekrar gönderir; "iki kez işlendi mi?" sorusu uygulama koduna
--      güvenmeden cevaplanmalı.
--   2. Buton token'ı DÜZ METİN saklanmaz (`sha256`) ve TEK KULLANIMLIKTIR —
--      `phone_verification_codes` deseninin aynısı.

create type webhook_provider as enum ('whatsapp');

-- Gelen bir buton yanıtına verilen otomatik cevap da bir bildirimdir ve
-- `message_log`'da izlenebilir olmalı: "müşteriye ne yazdık?" sorusunun
-- cevabı kayıtta durmalı.
alter type notification_event add value 'auto_reply';
create type message_action_kind as enum ('confirm', 'cancel');

-- ---------------------------------------------------------------------------
-- Ham olay kaydı
-- ---------------------------------------------------------------------------
-- `tenant_id` NULLABLE: imza doğrulandıktan sonra kiracı `waba_id` üzerinden
-- çözülür ve ÇÖZÜLEMEYEN olay da kaydedilmelidir — "hiç gelmedi mi, gelip
-- eşleşmedi mi?" ayrımı bir kör nokta bırakmamalı.
create table webhook_events (
  id          uuid primary key default gen_random_uuid(),
  provider    webhook_provider not null,
  event_id    text not null,
  tenant_id   uuid references tenants(id) on delete cascade,
  payload     jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error       text
);

create unique index webhook_events_provider_event_key on webhook_events (provider, event_id);
create index webhook_events_received_idx on webhook_events (received_at desc);

-- ---------------------------------------------------------------------------
-- Gelen mesajlar (gelen kutusu)
-- ---------------------------------------------------------------------------
create table inbound_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  -- Tanınmayan numara: müşteri kaydı OLMAYABİLİR. Mesajı düşürmek, kliniğe
  -- yazan bir kişiyi görünmez yapmak demekti.
  customer_id uuid references customers(id) on delete set null,
  from_phone  text not null,
  wa_message_id text not null,
  message_type  text not null default 'text',
  body        text,
  media_id    text,
  received_at timestamptz not null default now(),
  handled_by  uuid references users(id) on delete set null,
  handled_at  timestamptz
);

create unique index inbound_messages_wa_key on inbound_messages (tenant_id, wa_message_id);
create index inbound_messages_inbox_idx
  on inbound_messages (tenant_id, received_at desc)
  where handled_at is null;

-- ---------------------------------------------------------------------------
-- Buton yanıtı token'ları
-- ---------------------------------------------------------------------------
create table message_actions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  message_log_id uuid references message_log(id) on delete set null,
  appointment_id uuid not null references appointments(id) on delete cascade,
  action         message_action_kind not null,
  -- DÜZ token saklanmaz; gelen değerin sha256'sı aranır.
  token_hash     text not null,
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create unique index message_actions_token_key on message_actions (token_hash);
create index message_actions_appointment_idx on message_actions (tenant_id, appointment_id);

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table webhook_events enable row level security;
alter table webhook_events force row level security;

-- Webhook kaydı kiracı context'i ÇÖZÜLMEDEN yazılır: imza doğrulanır,
-- olay kaydedilir, kiracı ondan sonra aranır. Bu yüzden politika sistem
-- bağlamını (`app.platform_admin`) da kabul ediyor — `tenants` tablosunun
-- (0005) deseninin aynısı. Kiracı yöneticisi yalnız KENDİ olaylarını görür.
create policy webhook_events_isolation on webhook_events
  using (
    tenant_id = current_tenant_id()
    or current_setting('app.platform_admin', true) = 'on'
  )
  with check (
    tenant_id is null
    or tenant_id = current_tenant_id()
    or current_setting('app.platform_admin', true) = 'on'
  );

-- Webhook, kiracıyı ÇÖZMEDEN ÖNCE `whatsapp_accounts` satırını okumak
-- zorunda: imzayı doğrulayacak app secret orada duruyor ve kiracı da
-- oradaki `waba_id`den çıkıyor. Bu yüzden sistem bağlamına (kuyruk/webhook)
-- SALT OKUMA hakkı veren ikinci bir politika ekleniyor — `tenants` (0005) ve
-- `webhook_events` ile aynı desen. Yazma yolu değişmedi: kiracı context'i
-- olmadan hiçbir satır güncellenemez.
create policy whatsapp_accounts_system_read on whatsapp_accounts
  for select
  using (current_setting('app.platform_admin', true) = 'on');

alter table inbound_messages enable row level security;
alter table inbound_messages force row level security;
create policy inbound_messages_isolation on inbound_messages
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table message_actions enable row level security;
alter table message_actions force row level security;
create policy message_actions_isolation on message_actions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger message_actions_audit
  after insert or update or delete on message_actions
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update on webhook_events to klinara_app;
grant select, insert, update on inbound_messages to klinara_app;
grant select, insert, update on message_actions to klinara_app;
-- Kanıt niteliğindeki üç tablo da SİLİNMEZ.
revoke delete on webhook_events from klinara_app;
revoke delete on inbound_messages from klinara_app;
revoke delete on message_actions from klinara_app;
