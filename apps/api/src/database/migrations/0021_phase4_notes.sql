-- Batch 4.2 — müşteri notları, düzenleme geçmişi ve birleşik zaman çizelgesi.

create type customer_note_kind as enum (
  'general',    -- serbest not (resepsiyon da görür)
  'treatment',  -- randevuya bağlı işlem notu (klinik)
  'internal'    -- yalnız klinik ekibi
);

create table customer_notes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  -- İşlem notu bir randevuya bağlanır; serbest not bağlanmaz.
  appointment_id uuid references appointments(id) on delete set null,
  kind           customer_note_kind not null default 'general',
  body           text not null check (length(trim(body)) > 0),
  -- Müşteriye gösterilebilir mi (online sayfa, Faz 9). Klinik notu varsayılan
  -- olarak GÖRÜNMEZ; tersi bir varsayılan, bir gün yanlış notun müşteriye
  -- düşmesi demekti.
  customer_visible boolean not null default false,
  author_user_id uuid references users(id),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index customer_notes_customer_idx
  on customer_notes (tenant_id, customer_id, created_at desc)
  where deleted_at is null;

create index customer_notes_appointment_idx
  on customer_notes (appointment_id)
  where appointment_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Düzenleme geçmişi — append-only
-- ---------------------------------------------------------------------------
-- "Notta ne yazıyordu?" sorusu bir tıbbi/hukuki tartışmada sorulur. Eski metnin
-- korunması bu yüzden uygulamaya bırakılamaz.
create table customer_note_revisions (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  note_id   uuid not null references customer_notes(id) on delete cascade,
  /** Düzenlemeden ÖNCEKİ metin. */
  body      text not null,
  version   integer not null,
  edited_by uuid references users(id),
  edited_at timestamptz not null default now()
);

create index customer_note_revisions_note_idx
  on customer_note_revisions (note_id, edited_at desc);

create trigger customer_note_revisions_immutable
  before update or delete on customer_note_revisions
  for each row execute function reject_mutation();

-- Revizyonu TRIGGER yazar, servis değil (Faz 3 felsefesi: son savunma hattı DB).
-- Bir güncelleme yolunun revizyon yazmayı unutması mümkün olmamalı.
create or replace function customer_notes_write_revision() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body then
    insert into customer_note_revisions (tenant_id, note_id, body, version, edited_by)
    values (old.tenant_id, old.id, old.body, old.version, current_actor_id());
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create trigger customer_notes_revision
  before update on customer_notes
  for each row execute function customer_notes_write_revision();

-- Kapsam: FK doğrulaması RLS'i bypass eder.
create or replace function customer_notes_validate_scope() returns trigger
language plpgsql as $$
declare
  v_customer_tenant    uuid;
  v_appointment_tenant uuid;
begin
  select tenant_id into v_customer_tenant from customers where id = new.customer_id;
  if v_customer_tenant is distinct from new.tenant_id then
    raise exception 'Müşteri başka bir kiracıya ait.' using errcode = 'check_violation';
  end if;

  if new.appointment_id is not null then
    select tenant_id into v_appointment_tenant from appointments where id = new.appointment_id;
    if v_appointment_tenant is distinct from new.tenant_id then
      raise exception 'Randevu başka bir kiracıya ait.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger customer_notes_scope_check
  before insert or update on customer_notes
  for each row execute function customer_notes_validate_scope();

-- ---------------------------------------------------------------------------
-- RLS, denetim ve yetkiler
-- ---------------------------------------------------------------------------
alter table customer_notes enable row level security;
alter table customer_notes force row level security;
create policy customer_notes_isolation on customer_notes
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table customer_note_revisions enable row level security;
alter table customer_note_revisions force row level security;
create policy customer_note_revisions_isolation on customer_note_revisions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger customer_notes_set_updated_at
  before update on customer_notes for each row execute function set_updated_at();

create trigger customer_notes_audit
  after insert or update or delete on customer_notes
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on customer_notes to klinara_app;
grant select, insert on customer_note_revisions to klinara_app;
revoke update, delete on customer_note_revisions from klinara_app;
