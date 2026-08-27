-- Faz 3.3 — Idempotency ve randevu geçmişi.

-- ---------------------------------------------------------------------------
-- idempotency_keys (API sözleşmesi 5.6)
-- ---------------------------------------------------------------------------
-- Mobil istemci zayıf bağlantıda isteği tekrarlar; kullanıcı "Kaydet"e iki kez
-- basar. Anahtar olmadan ikisi de İKİ randevu üretir. `request_hash`, aynı
-- anahtarın farklı bir gövdeyle geri gelmesini de yakalar — o durum sessizce
-- eski yanıtı döndürülecek bir tekrar değil, bir istemci hatasıdır.
create table idempotency_keys (
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  key             text        not null,
  request_hash    text        not null,
  response_status integer,
  response_body   jsonb,
  locked_at       timestamptz,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours',
  primary key (tenant_id, key)
);

create index idempotency_keys_expiry_idx on idempotency_keys (expires_at);

alter table idempotency_keys enable row level security;
alter table idempotency_keys force row level security;
create policy idempotency_keys_isolation on idempotency_keys
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on idempotency_keys to klinara_app;

-- ---------------------------------------------------------------------------
-- appointment_history
-- ---------------------------------------------------------------------------
-- `audit_log` teknik bir izdir (satır öncesi/sonrası); bu ise İŞ olayıdır ve
-- kullanıcıya gösterilir: "kim erteledi, neden iptal etti". Ayrı tutulmasının
-- sebebi budur — audit kaydı kiracı yöneticisine ham JSON olarak açılamaz.
create type appointment_history_action as enum (
  'created', 'rescheduled', 'status_changed', 'cancelled', 'updated'
);

create table appointment_history (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  actor_user_id  uuid references users(id) on delete set null,
  action         appointment_history_action not null,
  from_status    appointment_status,
  to_status      appointment_status,
  old_starts_at  timestamptz,
  new_starts_at  timestamptz,
  reason         text,
  created_at     timestamptz not null default now()
);

create index appointment_history_appointment_idx
  on appointment_history (appointment_id, created_at desc);

-- Geçmiş KANITTIR: değiştirilemez, silinemez.
create trigger appointment_history_immutable
  before update or delete on appointment_history
  for each row execute function reject_mutation();

create or replace function appointment_history_validate_scope() returns trigger
language plpgsql as $$
declare
  v_appointment_tenant uuid;
begin
  select tenant_id into v_appointment_tenant from appointments where id = new.appointment_id;
  if v_appointment_tenant is distinct from new.tenant_id then
    raise exception 'Randevu başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger appointment_history_scope_check
  before insert on appointment_history
  for each row execute function appointment_history_validate_scope();

alter table appointment_history enable row level security;
alter table appointment_history force row level security;
create policy appointment_history_isolation on appointment_history
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Denetim trigger'ı YOK: tablo zaten değişmez bir olay kaydıdır, her satırını
-- ikinci kez audit_log'a kopyalamak yalnız yer harcardı.

grant select, insert on appointment_history to klinara_app;
revoke update, delete on appointment_history from klinara_app;
