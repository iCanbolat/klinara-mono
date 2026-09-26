-- Personel bildirim merkezi — panelin zil ikonu.
--
-- Bildirim KİŞİYE DEĞİL, kliniğe düşer: "online randevu geldi" resepsiyondaki
-- herkesi ilgilendiriyor ve kimin o an vardiyada olduğunu bildirim üretilirken
-- bilmiyoruz. Kullanıcı başına satır üretmek (fan-out) alıcı listesini
-- gönderim anında dondururdu; sonradan işe başlayan bir kullanıcı o bildirimi
-- hiç görmezdi.
--
-- Okundu bilgisi ise KİŞİSEL: aynı bildirimi bir kullanıcı okuduğunda
-- ötekinin sayacı düşmemeli. Bu yüzden ikinci, küçük bir tablo.
--
-- `message_log` ile karıştırılmamalı: orası MÜŞTERİYE giden iletilerin kaydı,
-- burası PERSONELE düşen panel bildirimleri.

create type staff_notification_kind as enum (
  'appointment_created',
  'appointment_cancelled',
  'appointment_rescheduled',
  'inbound_message',
  'delivery_failed'
);

create table staff_notifications (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  -- Şube: bildirim listesi şubeye göre süzülebilsin diye. Şubesiz olay olabilir.
  branch_id       uuid references branches(id) on delete cascade,
  kind            staff_notification_kind not null,
  title           text not null,
  body            text,
  -- Tıklayınca gidilecek panel yolu; `null` ise satır tıklanamaz.
  link            text,
  appointment_id  uuid references appointments(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index staff_notifications_feed_idx
  on staff_notifications (tenant_id, created_at desc, id);

create table staff_notification_reads (
  notification_id uuid not null references staff_notifications(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index staff_notification_reads_user_idx
  on staff_notification_reads (tenant_id, user_id);

alter table staff_notifications enable row level security;
alter table staff_notifications force row level security;
create policy staff_notifications_isolation on staff_notifications
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table staff_notification_reads enable row level security;
alter table staff_notification_reads force row level security;
create policy staff_notification_reads_isolation on staff_notification_reads
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert on staff_notifications to klinara_app;
grant select, insert on staff_notification_reads to klinara_app;
-- Bildirim GÜNCELLENMEZ ya da SİLİNMEZ: olmuş bir olayın kaydı. Okundu
-- bilgisi de geri alınmıyor; "okunmadı yap" bir ürün kararı olarak yok.
revoke update, delete on staff_notifications from klinara_app;
revoke update, delete on staff_notification_reads from klinara_app;
