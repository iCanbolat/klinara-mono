-- Davet ve parola sıfırlama token'ları (Batch 1.3).
--
-- İki tablo da aynı deseni izler: token DÜZ METİN saklanmaz (sha256), tek
-- kullanımlıktır ve süresi vardır. Token'ın kendisi yalnız bir kez, gönderim
-- anında var olur.

create table invitations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  branch_id          uuid references branches(id) on delete cascade,
  role_key           text not null references roles(key),
  email              citext not null,
  full_name          text,
  token_hash         text not null unique,
  invited_by_user_id uuid references users(id) on delete set null,
  expires_at         timestamptz not null,
  accepted_at        timestamptz,
  accepted_user_id   uuid references users(id) on delete set null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Aynı kiracıda aynı e-postaya AYNI ANDA tek bekleyen davet olabilir; kabul
-- edilmiş veya iptal edilmiş davetler tekilliğe girmez.
create unique index invitations_pending_key
  on invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;

create index invitations_tenant_idx on invitations (tenant_id, created_at desc);

create table password_reset_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  requested_ip inet,
  created_at   timestamptz not null default now()
);

create index password_reset_tokens_user_idx on password_reset_tokens (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table invitations enable row level security;
alter table invitations force row level security;

-- Davet KİRACI verisidir (kim kimi davet etti, hangi rolle) ama kabul akışı
-- kiracı context'i olmadan başlar: davetiye bağlantısına tıklayan kişi henüz
-- hiçbir kiracıya ait değildir.
create policy invitations_read on invitations
  for select
  using (current_auth_flow() or tenant_id = current_tenant_id());

create policy invitations_write on invitations
  for all
  using (current_auth_flow() or tenant_id = current_tenant_id())
  with check (current_auth_flow() or tenant_id = current_tenant_id());

alter table password_reset_tokens enable row level security;
alter table password_reset_tokens force row level security;
create policy password_reset_tokens_auth_only on password_reset_tokens
  for all
  using (current_auth_flow())
  with check (current_auth_flow());

/**
 * Davetin rolü ile şubesi tutarlı olmalı.
 *
 * `branch_id` foreign key'i tek başına YETMEZ: foreign key kontrolleri RLS'i
 * BYPASS EDER, dolayısıyla bir kiracı, başka bir kiracının şube kimliğini
 * yazarak geçerli görünen bir davet oluşturabilirdi. Hata ancak davet kabul
 * edilirken (üyelik trigger'ında) ortaya çıkar — yani yanlış kişiye, yanlış
 * zamanda.
 *
 * Kuralı `memberships_validate_scope` ile aynı yerde, aynı biçimde tutuyoruz.
 */
create or replace function invitations_validate_scope() returns trigger
language plpgsql as $$
declare
  v_scope         text;
  v_branch_tenant uuid;
begin
  select scope into v_scope from roles where key = new.role_key;

  if v_scope = 'platform' then
    raise exception 'Platform rolü davet edilemez (%).', new.role_key
      using errcode = 'check_violation';
  end if;

  if v_scope = 'branch' and new.branch_id is null then
    raise exception 'Şube kapsamlı rol (%) için branch_id zorunludur.', new.role_key
      using errcode = 'check_violation';
  end if;

  if v_scope = 'tenant' and new.branch_id is not null then
    raise exception 'Kiracı kapsamlı rol (%) şubeye bağlanamaz.', new.role_key
      using errcode = 'check_violation';
  end if;

  if new.branch_id is not null then
    select tenant_id into v_branch_tenant from branches where id = new.branch_id;
    if v_branch_tenant is distinct from new.tenant_id then
      raise exception 'Şube başka bir kiracıya ait.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

-- Trigger yalnız İLGİLİ kolonlar yazıldığında koşar.
--
-- Davet kabulü (`accepted_at` yazımı) KİMLİK AKIŞINDA, yani kiracı context'i
-- olmadan gerçekleşir; o anda `branches` sorgusu RLS yüzünden boş döner ve
-- kontrol yanlışlıkla "şube başka kiracıya ait" derdi. Kapsam kuralı zaten
-- yazım anında (insert) doğrulanmıştır.
create trigger invitations_scope_check
  before insert on invitations
  for each row execute function invitations_validate_scope();

create trigger invitations_scope_check_update
  before update of branch_id, role_key, tenant_id on invitations
  for each row execute function invitations_validate_scope();

create trigger invitations_set_updated_at
  before update on invitations for each row execute function set_updated_at();

-- Token hash'i denetim kaydına girmez.
create trigger invitations_audit
  after insert or update or delete on invitations
  for each row execute function audit_row_change_redacted('tenant_id', 'token_hash');

grant select, insert, update, delete on invitations, password_reset_tokens to klinara_app;
