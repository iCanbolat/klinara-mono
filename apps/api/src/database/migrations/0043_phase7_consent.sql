-- ---------------------------------------------------------------------------
-- Faz 7 (daraltılmış) — tek zorunlu KVKK/aydınlatma onayı
-- ---------------------------------------------------------------------------
-- Faz 7 orijinalinde dört onam türü (`kvkk_explicit`, `treatment`,
-- `photo_usage`, `marketing`), çok türlü bir şablon motoru
-- (`consent_templates`), imza yakalama (`consent_records`) ve PDF/QR doğrulama
-- öngörüyordu. Kapsam TEK zorunlu KVKK onayına daraltıldı:
--
--   * Treatment onamı booking'den çıktı — klinik içi, işlem öncesi ayrı akış
--     (MVP dışı).
--   * Marketing onamı MVP'den çıktı.
--   * Photo usage onamı MVP'den çıktı; dış paylaşım ucu KALICI olarak kapsam
--     dışı, fotoğraflar klinik içinde kalıyor.
--
-- Sonuç: `consent_templates` / `consent_records` / `service_required_consents`
-- HİÇ YAZILMIYOR. 9.4'ün `booking_consent_acceptances` "stub"ı kalıcı kanıt
-- tablosuna terfi ediyor; eksik olan tek şey SÜRÜM'dü, o da burada geliyor.

-- ---------------------------------------------------------------------------
-- Sürümlü onam metni
-- ---------------------------------------------------------------------------
-- Sürüm modeli `booking_page_revisions` + pointer kalıbının aynısı (0036):
-- yayın = `booking_site_settings.active_consent_document_id` taşımak. "Yayındaki
-- metni düzelttim" diye bir işlem YOK; yeni sürüm var. Aksi hâlde "müşteri
-- hangi metni onayladı" sorusu yıllar sonra cevaplanamaz olurdu.
create table consent_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  booking_site_id uuid not null references booking_sites(id) on delete cascade,

  -- Tek tür var. Kolon yine de duruyor: klinik içi işlem onamı bir gün
  -- gelirse şema değil yalnız check değişsin.
  kind    text not null default 'kvkk_explicit' check (kind = 'kvkk_explicit'),
  -- Taslakta NULL: sürüm numarası yayın anında, kilit altında üretiliyor.
  -- Taslağa peşinen numara vermek, iki taslak arasında sıra atlamalarına ve
  -- "v4 yayında ama v3 hiç var olmadı" sorusuna yol açardı.
  version integer check (version >= 1),
  locale  text not null default 'tr',

  body   text not null check (length(trim(body)) > 0),
  -- Sunucu hesaplar; istemcinin beyanı DEĞİL. Public uç bu hash'i döner,
  -- randevu isteği aynısını geri gönderir, eşleşmezse istek reddedilir.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),

  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),

  published_at timestamptz,
  published_by uuid references users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Yayınlanmış bir metnin sürümü ve yayın anı olmak ZORUNDA.
  constraint consent_documents_published_complete
    check (status = 'draft' or (published_at is not null and version is not null))
);

create unique index consent_documents_version_key
  on consent_documents (booking_site_id, kind, version);

-- Site başına en fazla BİR taslak: "hangi taslağı yayınlıyorum" sorusu
-- olmasın diye.
create unique index consent_documents_single_draft_key
  on consent_documents (booking_site_id, kind) where status = 'draft';

create index consent_documents_site_idx
  on consent_documents (tenant_id, booking_site_id, status);

-- `reject_mutation()` burada kullanılamaz: taslak SERBESTÇE düzenlenebilir
-- olmalı. Yayınlanmış satırda ise yalnız `published -> archived` geçişi
-- serbest; gövde, hash ve sürüm dokunulmaz.
create or replace function reject_published_consent_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Yayınlanmış onam metni silinemez (sürüm %).', old.version
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status <> 'draft' then
    if new.body is distinct from old.body
       or new.sha256 is distinct from old.sha256
       or new.version is distinct from old.version
       or new.kind is distinct from old.kind
       or new.locale is distinct from old.locale
       or new.published_at is distinct from old.published_at
       or new.booking_site_id is distinct from old.booking_site_id then
      raise exception 'Yayınlanmış onam metni değiştirilemez (sürüm %).', old.version
        using errcode = 'restrict_violation';
    end if;
    if new.status not in ('published', 'archived') then
      raise exception 'Yayınlanmış onam metni taslağa döndürülemez (sürüm %).', old.version
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end $$;

create trigger consent_documents_published_immutable
  before update or delete on consent_documents
  for each row execute function reject_published_consent_mutation();

create trigger consent_documents_set_updated_at
  before update on consent_documents for each row execute function set_updated_at();

create trigger consent_documents_audit
  after insert or update or delete on consent_documents
  for each row execute function audit_row_change('tenant_id');

alter table consent_documents enable row level security;
alter table consent_documents force row level security;
create policy consent_documents_isolation on consent_documents
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on consent_documents to klinara_app;
-- Taslak silme uygulamadan DEĞİL, yayınla akışından geçiyor; kalıcı silme
-- yolu açık bırakılmıyor.
revoke delete on consent_documents from klinara_app;

-- ---------------------------------------------------------------------------
-- Ayarlar: `consent_texts` dizisi -> tek pointer
-- ---------------------------------------------------------------------------
alter table booking_site_settings
  add column active_consent_document_id uuid references consent_documents(id);

comment on column booking_site_settings.active_consent_document_id is
  'Yayındaki KVKK onam metni. Site ancak bu dolu iken yayınlanabilir.';

-- Mevcut `consent_texts` içindeki kvkk_explicit girdisi v1 olarak taşınıyor.
-- `marketing` girdileri TAŞINMIYOR — MVP dışı.
insert into consent_documents
  (tenant_id, booking_site_id, kind, version, locale, body, sha256, status, published_at)
select
  s.tenant_id,
  s.booking_site_id,
  'kvkk_explicit',
  1,
  coalesce(s.locales[1], 'tr'),
  c.text,
  encode(digest(c.text, 'sha256'), 'hex'),
  'published',
  now()
from booking_site_settings s
cross join lateral (
  select item ->> 'text' as text
  from jsonb_array_elements(s.consent_texts) as item
  where item ->> 'kind' = 'kvkk_explicit'
    and length(trim(coalesce(item ->> 'text', ''))) > 0
  limit 1
) c;

update booking_site_settings s
set active_consent_document_id = d.id
from consent_documents d
where d.booking_site_id = s.booking_site_id and d.version = 1;

alter table booking_site_settings drop column consent_texts;

-- ---------------------------------------------------------------------------
-- Kabul kanıtı: STUB DEĞİL, kalıcı tablo
-- ---------------------------------------------------------------------------
-- 0037'nin `consent_record_id` köprüsü artık gereksiz: taşınacak bir
-- `consent_records` yok, kanıtın kalıcı evi BU tablo. Yerine dokümana ve
-- sürüme bağlanıyor.
alter table booking_consent_acceptances
  add column consent_document_id uuid references consent_documents(id),
  add column consent_version integer,
  add column locale text;

-- Değişmezlik trigger'ı GEÇİCİ olarak kapatılıyor: bu geriye dönük doldurma
-- kanıtı DEĞİŞTİRMİYOR (gövde ve hash'e dokunmuyor), yalnız yeni sürüm
-- kolonlarını dolduruyor. Migration DDL'i zaten sahibin elinde; uygulamanın
-- bu yolu yok ve olmamalı.
alter table booking_consent_acceptances disable trigger booking_consent_acceptances_immutable;

update booking_consent_acceptances a
set consent_document_id = d.id,
    consent_version     = d.version,
    locale              = d.locale
from consent_documents d
where d.booking_site_id = a.booking_site_id
  and d.sha256 = a.text_sha256;

alter table booking_consent_acceptances enable trigger booking_consent_acceptances_immutable;

-- Eşleşmeyen satırlar (ör. artık kapsam dışı `marketing` kabulleri) SİLİNMEZ:
-- kanıt değişmez. `text_body` + `text_sha256` zaten tek başına yeterli kanıt;
-- yalnız sürüme bağlanamıyorlar.
comment on column booking_consent_acceptances.consent_document_id is
  '0043 öncesi satırlarda null olabilir; kanıt text_body/text_sha256 ile tamdır.';

drop index booking_consent_acceptances_unmigrated_idx;
alter table booking_consent_acceptances drop column consent_record_id;

create index booking_consent_acceptances_customer_idx
  on booking_consent_acceptances (tenant_id, customer_id, accepted_at desc);
