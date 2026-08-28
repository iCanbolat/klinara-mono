-- Batch 8.1 — bildirim çekirdeği.
--
-- Buranın işi TEK BİR GÖNDERİM YOLU kurmak. Bugüne kadar sistemin dışarıya
-- mesaj gönderme yolu yoktu: davet e-postası loga yazılıyordu, paket süresi
-- dolduğunda müşteri haberdar olmuyordu. Kanal (whatsapp/sms/email) bir
-- ADAPTER ayrıntısıdır; bu şema kanaldan bağımsız olarak "kime, hangi olay
-- için, ne zaman, hangi şablonla, hangi sonuçla" sorusunu cevaplar.
--
-- Üç kural şemaya gömülüdür:
--   1. Ham telefon/e-posta `message_log`'da SAKLANMAZ (`to_masked`). Mesaj
--      kaydı yıllarca duran bir tablodur; kişisel veriyi orada biriktirmek
--      KVKK açısından taşımak zorunda olmadığımız bir yük.
--   2. Engellenen mesaj ATILMAZ, `skipped` olarak yazılır. "Gitmedi mi, hiç
--      denendi mi?" sorusu cevapsız kalmamalı.
--   3. Çift gönderim koruması VERİDEN gelir (`dedupe_key` kısmi tekil indeksi),
--      worker'ın dikkatinden değil.

create type notification_channel as enum ('whatsapp', 'sms', 'email', 'push');

-- Olay listesi ŞABLONUN anahtarıdır. Yeni olay eklemek enum'a değer eklemek
-- demektir; değer çıkarmak ise geçmiş `message_log` satırlarını okunamaz
-- yapardı, bu yüzden yapılmaz.
create type notification_event as enum (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'no_show_followup',
  'package_balance',
  'package_expiring',
  'birthday',
  -- Personele giden iç bildirim (gönderim başarısızlığı vb. — 8.4).
  'staff_internal'
);

create type message_status as enum
  ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped');

-- İŞLEMSEL ve PAZARLAMA ayrı yönetilir: opt-out eden müşteriye kampanya
-- gitmez ama randevu hatırlatması gider — randevusunu bilmemesi müşterinin
-- kendi zararına olurdu ve bu bir ticari ileti değildir.
create type notification_kind as enum ('transactional', 'marketing');

create type opt_out_source as enum ('customer_request', 'inbound_stop', 'staff');

-- ---------------------------------------------------------------------------
-- Şablonlar
-- ---------------------------------------------------------------------------
-- Kiracı satırı YOKSA kod içindeki varsayılan şablon kullanılır. Seed her
-- kiracıya satır basmaz: basılsaydı şablon metnini iyileştiren her sürüm,
-- kiracı sayısı kadar satırı göç ettirmek zorunda kalırdı.
create table notification_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  event      notification_event   not null,
  channel    notification_channel not null,
  locale     text not null default 'tr',

  -- E-posta için konu; diğer kanallarda null.
  subject    text,
  body       text not null,

  -- WhatsApp'ta metin İSTEMCİDEN değil Meta'da onaylı template'ten gelir;
  -- burada yalnız hangi template'in kullanılacağı durur (8.2 doldurur).
  whatsapp_template_name     text,
  whatsapp_template_language text,

  is_active  boolean not null default true,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_templates_body_not_blank check (length(trim(body)) > 0),
  constraint notification_templates_subject_only_email check (
    channel = 'email' or subject is null
  )
);

create unique index notification_templates_key
  on notification_templates (tenant_id, event, channel, locale);

-- ---------------------------------------------------------------------------
-- Tercihler ve sessiz saatler
-- ---------------------------------------------------------------------------
-- `branch_id is null` satırı KİRACI VARSAYILANI, şube satırı onu EZER.
-- İki ayrı tablo yerine tek tablo + nullable şube: "hangi ayar geçerli?"
-- sorusunun cevabı tek bir sorguda kalır.
create table notification_preferences (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  branch_id  uuid references branches(id) on delete cascade,
  event      notification_event not null,

  -- `kind` (işlemsel/pazarlama) BURADA YOK: olayın doğasıdır, kiracı ayarı
  -- değil. Kolon açsaydık aynı gerçeğin ikinci kopyası olur ve bir gün
  -- koddaki tanımdan ayrılırdı — "randevu hatırlatması pazarlama sayıldı"
  -- gibi bir hatanın tam olarak kaynağı budur. Tek kaynak:
  -- `default-templates.ts` içindeki `EVENT_DEFINITIONS`.
  -- Denenecek kanallar, ÖNCELİK SIRASINDA. Boş dizi = bu olay kapalı.
  channels   notification_channel[] not null default '{}',

  -- Sessiz saatler ŞUBE SAAT DİLİMİNDE yorumlanır (branches.timezone).
  -- Gece yarısını aşan pencere geçerlidir: 22:00–09:00 gibi.
  quiet_hours_start time,
  quiet_hours_end   time,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_preferences_quiet_pair check (
    (quiet_hours_start is null) = (quiet_hours_end is null)
  )
);

-- İki ayrı kısmi tekil indeks: PostgreSQL'de `null` değerler tekillik
-- karşılaştırmasında birbirine eşit sayılmaz, yani tek bir
-- `unique (tenant_id, branch_id, event)` kiracı varsayılanının İKİ KEZ
-- yazılmasını engellemezdi.
create unique index notification_preferences_branch_key
  on notification_preferences (tenant_id, branch_id, event)
  where branch_id is not null;

create unique index notification_preferences_tenant_key
  on notification_preferences (tenant_id, event)
  where branch_id is null;

-- ---------------------------------------------------------------------------
-- Mesaj kaydı
-- ---------------------------------------------------------------------------
create table message_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  branch_id  uuid references branches(id) on delete set null,

  -- Alıcı ya bir müşteri ya bir kullanıcıdır (iç bildirim). İkisi birden
  -- olmaz; hiçbiri olmaması da olmaz — kime gittiği bilinmeyen bir mesaj
  -- kaydının denetim değeri yok.
  customer_id uuid references customers(id) on delete set null,
  user_id     uuid references users(id) on delete set null,

  channel    notification_channel not null,
  event      notification_event   not null,
  kind       notification_kind    not null default 'transactional',
  status     message_status       not null default 'queued',

  -- HAM adres YOK. `+905321234567` → `+90**********67`.
  to_masked  text not null,
  template_id uuid references notification_templates(id) on delete set null,

  -- Gönderilen metnin kopyası: şablon sonradan değişse de "ne gönderildi"
  -- sorusu cevaplanabilir kalır.
  rendered_subject text,
  rendered_body    text,

  provider            text,
  provider_message_id text,
  error_code          text,
  error_detail        text,
  attempt             integer not null default 0,

  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  failed_at     timestamptz,

  -- Çift gönderim koruması. 8.4'te hatırlatma satırının kimliği buraya yazılır.
  dedupe_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint message_log_recipient_ck check (
    (customer_id is not null and user_id is null) or
    (customer_id is null and user_id is not null)
  )
);

-- `failed` HARİÇ: kalıcı olarak başarısız olmuş bir gönderim, aynı anahtarla
-- yeniden denenebilmelidir (numara düzeltilir, şablon onaylanır).
create unique index message_log_dedupe_key
  on message_log (tenant_id, dedupe_key)
  where dedupe_key is not null and status <> 'failed';

create index message_log_tenant_created_idx
  on message_log (tenant_id, created_at desc, id desc);
create index message_log_customer_idx
  on message_log (tenant_id, customer_id, created_at desc)
  where customer_id is not null;
-- Gelen durum bildirimleri (8.3) sağlayıcı kimliğinden satırı bulur.
create index message_log_provider_message_idx
  on message_log (tenant_id, provider_message_id)
  where provider_message_id is not null;
-- Kuyruk worker'ının bekleyen işi bulması için.
create index message_log_pending_idx
  on message_log (tenant_id, scheduled_for)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- Opt-out (ileti reddi)
-- ---------------------------------------------------------------------------
-- Satır SİLİNMEZ: geri alma `revoked_at` doldurur. "Müşteri ne zaman redde
-- geçti, ne zaman geri aldı?" sorusu ticari ileti mevzuatında kanıt konusudur.
create table contact_opt_outs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  -- `null` kanal = TÜM kanallar.
  channel     notification_channel,
  kind        notification_kind not null default 'marketing',
  source      opt_out_source not null default 'customer_request',
  note        text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references users(id) on delete set null
);

create unique index contact_opt_outs_active_channel_key
  on contact_opt_outs (tenant_id, customer_id, channel, kind)
  where revoked_at is null and channel is not null;

create unique index contact_opt_outs_active_all_key
  on contact_opt_outs (tenant_id, customer_id, kind)
  where revoked_at is null and channel is null;

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table notification_templates enable row level security;
alter table notification_templates force row level security;
create policy notification_templates_isolation on notification_templates
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table notification_preferences enable row level security;
alter table notification_preferences force row level security;
create policy notification_preferences_isolation on notification_preferences
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table message_log enable row level security;
alter table message_log force row level security;
create policy message_log_isolation on message_log
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table contact_opt_outs enable row level security;
alter table contact_opt_outs force row level security;
create policy contact_opt_outs_isolation on contact_opt_outs
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger notification_templates_set_updated_at
  before update on notification_templates for each row execute function set_updated_at();
create trigger notification_preferences_set_updated_at
  before update on notification_preferences for each row execute function set_updated_at();
create trigger message_log_set_updated_at
  before update on message_log for each row execute function set_updated_at();

create trigger notification_templates_audit
  after insert or update or delete on notification_templates
  for each row execute function audit_row_change('tenant_id');
create trigger notification_preferences_audit
  after insert or update or delete on notification_preferences
  for each row execute function audit_row_change('tenant_id');
create trigger contact_opt_outs_audit
  after insert or update or delete on contact_opt_outs
  for each row execute function audit_row_change('tenant_id');

-- `message_log`'a audit trigger BİLEREK bağlanmadı: her mesaj gönderiminde
-- durum en az üç kez güncelleniyor (queued → sending → sent → delivered) ve
-- her biri denetim tablosuna satırın TAMAMINI iki kopya hâlinde yazardı.
-- Mesaj kaydının kendisi zaten bir denetim izidir.

grant select, insert, update, delete on notification_templates to klinara_app;
grant select, insert, update, delete on notification_preferences to klinara_app;
grant select, insert, update on message_log to klinara_app;
-- Mesaj kaydı silinmez: gönderdiğimiz iletinin izi kalmalı.
revoke delete on message_log from klinara_app;
grant select, insert, update on contact_opt_outs to klinara_app;
revoke delete on contact_opt_outs from klinara_app;

-- ---------------------------------------------------------------------------
-- 8.1 izinleri
-- ---------------------------------------------------------------------------
-- `notification:manage` `notification:send` üzerine BİNMEZ: resepsiyon tek bir
-- mesaj gönderebilir ama kiracının tüm müşterilerine giden şablonu
-- değiştiremez. Şablon hatası binlerce yanlış mesaj demektir.
insert into permissions (key, description) values
  ('notification:read',   'Mesaj kaydı ve gelen kutusunu görüntüleme'),
  ('notification:manage', 'Bildirim şablonları, tercihleri ve entegrasyon yönetimi')
on conflict (key) do update
  set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',        'notification:read'),
  ('owner',        'notification:manage'),
  ('manager',      'notification:read'),
  ('manager',      'notification:manage'),
  ('receptionist', 'notification:read'),
  ('practitioner', 'notification:read')
on conflict do nothing;
