-- Batch 8.4 — hatırlatma zamanlaması.
--
-- Çekirdek garanti ŞEMADA değil, YAZIM YERİNDE: hatırlatma satırı ve pg-boss
-- işi randevunun KENDİ transaction'ında doğar (mimari karar 4.6). Randevu
-- rollback olursa hatırlatma da olmaz; outbox pattern'e bu yüzden gerek yok.
--
-- Şemanın taşıdığı garanti tek ve nettir: aynı randevu için aynı tür
-- hatırlatma İKİ KEZ planlanamaz (kısmi tekil indeks). "İki kez gönderilmesin"
-- kuralını worker'ın dikkatine bırakmak, eş zamanlı iki worker'da er ya da geç
-- çift mesaj demekti.

create type scheduled_notification_status as enum
  ('pending', 'sent', 'cancelled', 'superseded');

-- Şube bazlı hatırlatma ayarı. Boş dizi/`null` alanlar kiracı ayarına
-- (`tenant_settings`) düşer: iki yerde saklanan aynı varsayılan, er ya da geç
-- birbirinden ayrılırdı.
create table branch_notification_settings (
  branch_id uuid primary key references branches(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- Randevudan kaç saat önce; boş dizi = şubenin kendi ayarı yok.
  reminder_hours_before integer[] not null default '{}',
  no_show_followup_enabled boolean not null default true,
  no_show_followup_delay_hours integer not null default 2
    check (no_show_followup_delay_hours between 0 and 168),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint branch_reminder_hours_sane check (
    array_length(reminder_hours_before, 1) is null
    or (array_length(reminder_hours_before, 1) <= 5
        and 0 < all(reminder_hours_before)
        and 720 >= all(reminder_hours_before))
  )
);

create table scheduled_notifications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  branch_id      uuid not null references branches(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,

  event        notification_event not null,
  -- Randevudan kaç saat önce planlandı. No-show takibinde NEGATİF: randevudan
  -- SONRA gider ve aynı tekillik kuralına girer.
  offset_hours integer not null,
  scheduled_for timestamptz not null,

  -- Gönderim anında doğan mesaj kaydı; planlama anında boş.
  message_log_id uuid references message_log(id) on delete set null,
  status scheduled_notification_status not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ÇEKİRDEK GARANTİ: aynı randevu + aynı tür + aynı offset için BEKLEYEN tek
-- satır. Erteleme eskisini `superseded` yapar ve yenisini yazar; ikisi bir
-- arada duramaz.
create unique index scheduled_notifications_pending_key
  on scheduled_notifications (appointment_id, event, offset_hours)
  where status = 'pending';

create index scheduled_notifications_due_idx
  on scheduled_notifications (tenant_id, scheduled_for)
  where status = 'pending';

create index scheduled_notifications_appointment_idx
  on scheduled_notifications (tenant_id, appointment_id);

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table branch_notification_settings enable row level security;
alter table branch_notification_settings force row level security;
create policy branch_notification_settings_isolation on branch_notification_settings
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table scheduled_notifications enable row level security;
alter table scheduled_notifications force row level security;
create policy scheduled_notifications_isolation on scheduled_notifications
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger branch_notification_settings_set_updated_at
  before update on branch_notification_settings for each row execute function set_updated_at();
create trigger scheduled_notifications_set_updated_at
  before update on scheduled_notifications for each row execute function set_updated_at();

create trigger branch_notification_settings_audit
  after insert or update or delete on branch_notification_settings
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on branch_notification_settings to klinara_app;
grant select, insert, update on scheduled_notifications to klinara_app;
-- Planlanmış hatırlatma SİLİNMEZ: iptal edilen bir hatırlatmanın izi,
-- "neden gitmedi?" sorusunun cevabıdır.
revoke delete on scheduled_notifications from klinara_app;
