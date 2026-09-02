-- Batch 9.5 — self-servis randevu yönetimi (imzalı, süreli bağlantı).
--
-- Token TEK randevuya erişim verir. Müşteri kartının tamamını açmaz: yanıt
-- randevu saati, hizmet adları, şube adresi ve klinik telefonundan ibarettir.
-- Bu bir sunum kararı değil, veri modeli kararıdır — token bir müşteriye değil
-- BİR RANDEVUYA bağlıdır, dolayısıyla "müşterinin geçmişini de göster" diye
-- bir genişleme yolu yoktur.

create table booking_access_tokens (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,

  -- Düz metin saklanmaz; bağlantı yalnız müşteriye giden mesajda yaşar.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  expires_at timestamptz not null,
  -- Kullanım sayacı: sınırsız kullanılabilen bir bağlantı, iletilmiş bir
  -- mesajdan sonsuza dek erişilebilir kalırdı.
  use_count  integer not null default 0 check (use_count >= 0),
  max_uses   integer not null default 100 check (max_uses > 0),
  revoked_at timestamptz,
  last_used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_access_tokens_appointment_idx
  on booking_access_tokens (tenant_id, appointment_id);

alter table booking_access_tokens enable row level security;
alter table booking_access_tokens force row level security;
create policy booking_access_tokens_isolation on booking_access_tokens
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create trigger booking_access_tokens_set_updated_at
  before update on booking_access_tokens for each row execute function set_updated_at();

grant select, insert, update on booking_access_tokens to klinara_app;
revoke delete on booking_access_tokens from klinara_app;
