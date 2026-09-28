-- ---------------------------------------------------------------------------
-- Klinikte imzalı onam — işlem onamı şablonları + klinik içi KVKK imzası
-- ---------------------------------------------------------------------------
-- 0043 onamı TEK zorunlu KVKK metnine daraltmıştı ve kanıt yalnız online
-- randevuda toplanıyordu. İki boşluk kapanıyor:
--
--   * İşlem onamı: hizmete bağlı, sürümlü şablonlar. Hasta işlem öncesi
--     klinikte tablete imzalar.
--   * Personelin açtığı randevular: telefonla/yüz yüze gelen hasta KVKK
--     metnini hiç onaylamıyordu. Aynı imza akışında KVKK da alınır.
--
-- Kalıplar 0043'ün aynısı: sürümlü gövde + pointer, yayınlanmış gövde
-- değişmez, kanıt satırı `reject_mutation()` ile değişmez.

-- ---------------------------------------------------------------------------
-- İşlem onamı şablonları
-- ---------------------------------------------------------------------------
create table consent_templates (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name      text not null check (length(trim(name)) between 1 and 120),
  -- NULL: her randevuda yeniden imzalanır. N: hastanın son N gün içindeki
  -- imzası yeterli (ör. 8 seanslık lazer paketi için 365).
  validity_days integer check (validity_days between 1 and 3650),
  -- Yayındaki sürüm. FK aşağıda, sürüm tablosu kurulduktan sonra ekleniyor.
  active_version_id uuid,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index consent_templates_tenant_idx on consent_templates (tenant_id, archived_at);

create table consent_template_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  template_id uuid not null references consent_templates(id) on delete cascade,
  version     integer check (version >= 1),
  body        text not null check (length(trim(body)) > 0),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  published_by uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint consent_template_versions_published_complete
    check (status = 'draft' or (published_at is not null and version is not null))
);

create unique index consent_template_versions_version_key
  on consent_template_versions (template_id, version);
-- Şablon başına en fazla BİR taslak (0043'teki gerekçe).
create unique index consent_template_versions_single_draft_key
  on consent_template_versions (template_id) where status = 'draft';

alter table consent_templates
  add constraint consent_templates_active_version_fk
  foreign key (active_version_id) references consent_template_versions(id);

-- Yayınlanmış gövde değişmez; yalnız `published -> archived` serbest.
create or replace function reject_published_template_version_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Yayınlanmış onam şablonu silinemez (sürüm %).', old.version
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status <> 'draft' then
    if new.body is distinct from old.body
       or new.sha256 is distinct from old.sha256
       or new.version is distinct from old.version
       or new.template_id is distinct from old.template_id
       or new.published_at is distinct from old.published_at then
      raise exception 'Yayınlanmış onam şablonu değiştirilemez (sürüm %).', old.version
        using errcode = 'restrict_violation';
    end if;
    if new.status not in ('published', 'archived') then
      raise exception 'Yayınlanmış onam şablonu taslağa döndürülemez (sürüm %).', old.version
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end $$;

create trigger consent_template_versions_published_immutable
  before update or delete on consent_template_versions
  for each row execute function reject_published_template_version_mutation();

create trigger consent_templates_set_updated_at
  before update on consent_templates for each row execute function set_updated_at();
create trigger consent_template_versions_set_updated_at
  before update on consent_template_versions for each row execute function set_updated_at();

create trigger consent_templates_audit
  after insert or update or delete on consent_templates
  for each row execute function audit_row_change('tenant_id');
create trigger consent_template_versions_audit
  after insert or update or delete on consent_template_versions
  for each row execute function audit_row_change('tenant_id');

-- ---------------------------------------------------------------------------
-- Hizmet → gerekli onam şablonları
-- ---------------------------------------------------------------------------
create table service_consent_templates (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  service_id  uuid not null references services(id) on delete cascade,
  template_id uuid not null references consent_templates(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (service_id, template_id)
);

create index service_consent_templates_template_idx
  on service_consent_templates (tenant_id, template_id);

create trigger service_consent_templates_audit
  after insert or update or delete on service_consent_templates
  for each row execute function audit_row_change('tenant_id');

-- ---------------------------------------------------------------------------
-- Klinikte atılan imza — KANIT, değişmez
-- ---------------------------------------------------------------------------
create table consent_signatures (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  branch_id      uuid references branches(id) on delete set null,
  customer_id    uuid references customers(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,

  kind text not null check (kind in ('kvkk_explicit', 'treatment')),
  consent_document_id uuid references consent_documents(id),
  template_id         uuid references consent_templates(id),
  template_version_id uuid references consent_template_versions(id),
  -- Belge adının ve sürümünün ANLIK kopyası: şablon sonradan yeniden
  -- adlandırılsa bile "hasta neyi imzaladı" cevaplanabilir kalır.
  document_title   text not null check (length(trim(document_title)) > 0),
  document_version integer not null check (document_version >= 1),

  -- Gösterilen metnin BİREBİR kopyası.
  text_body   text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),

  signer_name      text not null check (length(trim(signer_name)) between 2 and 120),
  signer_relation  text not null check (signer_relation in ('self', 'guardian')),
  guardian_of_name text check (guardian_of_name is null or length(trim(guardian_of_name)) between 2 and 120),

  signature_key    text not null,
  signature_sha256 text not null check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_key          text not null,
  pdf_sha256       text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),

  collected_by uuid references users(id) on delete set null,
  ip           inet,
  user_agent   text,
  signed_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  constraint consent_signatures_document_ref check (
    (kind = 'kvkk_explicit' and consent_document_id is not null and template_version_id is null)
    or (kind = 'treatment' and template_version_id is not null and template_id is not null
        and consent_document_id is null)
  ),
  constraint consent_signatures_guardian check (
    (signer_relation = 'self' and guardian_of_name is null)
    or (signer_relation = 'guardian' and guardian_of_name is not null)
  )
);

create index consent_signatures_customer_idx
  on consent_signatures (tenant_id, customer_id, signed_at desc);
create index consent_signatures_appointment_idx
  on consent_signatures (tenant_id, appointment_id);
create index consent_signatures_template_idx
  on consent_signatures (tenant_id, customer_id, template_id, signed_at desc)
  where kind = 'treatment';

create trigger consent_signatures_immutable
  before update or delete on consent_signatures
  for each row execute function reject_mutation();
-- Audit trigger'ı YOK: satırın kendisi değişmez kanıt ve kimin aldığı
-- (`collected_by`) içinde. Audit, 20k'lık metni ikinci kez kopyalardı.

-- ---------------------------------------------------------------------------
-- Randevu geçmişi ve erişim kaydı
-- ---------------------------------------------------------------------------
-- Onam eksikken işleme geçildi: gerekçe `appointment_history.reason`da.
alter type appointment_history_action add value 'consent_override';
-- İmzalı onam PDF'inin görüntülenmesi KVKK m.6 erişim kaydına düşer.
alter type record_access_resource add value 'consent';

-- ---------------------------------------------------------------------------
-- İzin: klinikte imza alma
-- ---------------------------------------------------------------------------
-- `consent:manage` üzerine BİNMEZ: uygulayıcı hastaya imza attırabilir ama
-- kiracının onam METİNLERİNİ değiştiremez.
insert into permissions (key, description) values
  ('consent:collect', 'Klinikte hastadan imzalı onam alma')
on conflict (key) do update
  set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',        'consent:collect'),
  ('manager',      'consent:collect'),
  ('receptionist', 'consent:collect'),
  ('practitioner', 'consent:collect')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS ve yetkiler
-- ---------------------------------------------------------------------------
alter table consent_templates enable row level security;
alter table consent_templates force row level security;
create policy consent_templates_isolation on consent_templates
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table consent_template_versions enable row level security;
alter table consent_template_versions force row level security;
create policy consent_template_versions_isolation on consent_template_versions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table service_consent_templates enable row level security;
alter table service_consent_templates force row level security;
create policy service_consent_templates_isolation on service_consent_templates
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table consent_signatures enable row level security;
alter table consent_signatures force row level security;
create policy consent_signatures_isolation on consent_signatures
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on consent_templates to klinara_app;
-- Şablon silinmez, arşivlenir: eski imzalar ona bağlı.
revoke delete on consent_templates from klinara_app;
grant select, insert, update on consent_template_versions to klinara_app;
revoke delete on consent_template_versions from klinara_app;
grant select, insert, delete on service_consent_templates to klinara_app;
grant select, insert on consent_signatures to klinara_app;
revoke update, delete on consent_signatures from klinara_app;
