-- Kimlik çekirdeği: kullanıcılar, üyelikler, roller ve izinler (Batch 1.1).
--
-- `users` KİRACI-ÜSTÜ bir tablodur: bir kullanıcı birden çok klinikte
-- çalışabilir (zincir merkezlerde ve muhasebecilerde bu kural değil istisna
-- değildir). Kiracıya bağlanma noktası `memberships`tir.

-- ---------------------------------------------------------------------------
-- Kimlik akışı bayrağı
-- ---------------------------------------------------------------------------
-- Giriş, parola sıfırlama ve davet kabulü kiracı SEÇİLMEDEN önce koşar: sunucu
-- "bu e-posta kime ait?" sorusunu cevaplayabilmek için kiracı context'i olmayan
-- bir sorgu yapmak zorundadır. RLS bu soruya yardım edemez; bu yüzden kimlik
-- akışı AÇIKÇA işaretlenir ve yalnız `TenantTxService.runAsAuth()` bu bayrağı
-- set eder. Bayrağın adı tektir, kullanımı sayılıdır ve denetlenebilir —
-- alternatifi (uygulama rolüne BYPASSRLS vermek) tüm izolasyonu çöpe atardı.
create or replace function current_auth_flow() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('app.auth_flow', true), ''), 'off') = 'on'
$$;

-- Denetim kaydının SIR sızdırmayan sürümü.
--
-- `audit_row_change` satırın tamamını `to_jsonb` ile yazar; `users` gibi
-- tablolarda bu, parola hash'ini denetim kaydına düz metin olarak taşır.
-- Burada tg_argv[1] ile verilen kolonlar kayıttan ÇIKARILIR.
create or replace function audit_row_change_redacted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_record     jsonb;
  v_tenant_col text  := coalesce(tg_argv[0], 'tenant_id');
  v_redact     text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
  v_tenant     uuid;
  v_record_id  uuid;
begin
  v_record := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  v_tenant := coalesce(nullif(v_record ->> v_tenant_col, '')::uuid, current_tenant_id());
  v_record_id := nullif(v_record ->> 'id', '')::uuid;

  insert into audit_log (
    tenant_id, actor_user_id, table_name, record_id, action, old_data, new_data, request_id
  ) values (
    v_tenant,
    current_actor_id(),
    tg_table_name,
    v_record_id,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - v_redact end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - v_redact end,
    current_request_id()
  );

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---------------------------------------------------------------------------
-- Referans veri: roller, izinler
-- ---------------------------------------------------------------------------
-- Bu tablolar kiracıya ait DEĞİLDİR; sistem sözleşmesidir. `klinara_app` rolü
-- yalnız okuyabilir (aşağıdaki revoke), dolayısıyla uygulama bir hatayla bile
-- kendi yetkisini genişletemez.

create table permissions (
  key         text primary key,
  description text not null,
  created_at  timestamptz not null default now()
);

create table roles (
  key        text primary key,
  scope      text    not null check (scope in ('platform', 'tenant', 'branch')),
  name       text    not null,
  -- Yetki genişliği. Davet akışında kullanılır: kimse KENDİNDEN yüksek rank'li
  -- bir rolü atayamaz.
  rank       integer not null,
  is_system  boolean not null default true,
  created_at timestamptz not null default now()
);

create table role_permissions (
  role_key       text not null references roles(key) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

insert into permissions (key, description) values
  ('tenant:read',              'Kiracı bilgilerini görüntüleme'),
  ('tenant:write',             'Kiracı bilgilerini ve ayarlarını değiştirme'),
  ('branch:read',              'Şubeleri görüntüleme'),
  ('branch:write',             'Şube açma ve düzenleme'),
  ('user:read',                'Kullanıcıları görüntüleme'),
  ('user:write',               'Kullanıcı bilgilerini ve rollerini düzenleme'),
  ('user:invite',              'Personel daveti gönderme'),
  ('appointment:read.own',     'Yalnız kendi randevularını görüntüleme'),
  ('appointment:read.all',     'Tüm takvimi görüntüleme'),
  ('appointment:write',        'Randevu oluşturma ve düzenleme'),
  ('appointment:reopen',       'Tamamlanmış randevuyu geri açma'),
  ('service:read',             'Hizmet kataloğunu görüntüleme'),
  ('service:write',            'Hizmet ve fiyat düzenleme'),
  ('resource:read',            'Personel, oda ve cihazları görüntüleme'),
  ('resource:write',           'Personel, oda ve cihaz düzenleme'),
  ('customer:read',            'Müşteri kartını görüntüleme'),
  ('customer:write',           'Müşteri kartı oluşturma ve düzenleme'),
  ('customer.medical:read',    'Tıbbi kayıt ve fotoğrafları görüntüleme'),
  ('customer.medical:write',   'Tıbbi kayıt ve fotoğraf ekleme'),
  ('package:read',             'Paket ve seans hakkını görüntüleme'),
  ('package:write',            'Paket satışı ve seans düzenleme'),
  ('finance.payment:read',     'Tahsilatları görüntüleme'),
  ('finance.payment:write',    'Tahsilat ve iade işlemi'),
  ('finance.commission:read',  'Personel primlerini görüntüleme'),
  ('report.revenue:read',      'Ciro raporlarını görüntüleme'),
  ('consent:read',             'Onam kayıtlarını görüntüleme'),
  ('consent:manage',           'Onam şablonu ve imza yönetimi'),
  ('notification:send',        'Hatırlatma ve bildirim gönderme'),
  ('audit:read',               'Denetim kaydını görüntüleme');

insert into roles (key, scope, name, rank) values
  ('platform_admin', 'platform', 'Platform Yöneticisi', 100),
  ('owner',          'tenant',   'İşletme Sahibi',       80),
  ('manager',        'branch',   'Şube Yöneticisi',      60),
  ('accountant',     'tenant',   'Muhasebe',             40),
  ('receptionist',   'branch',   'Resepsiyon',           30),
  ('practitioner',   'branch',   'Uygulayıcı',           20);

insert into role_permissions (role_key, permission_key) values
  ('owner', 'tenant:read'),
  ('owner', 'tenant:write'),
  ('owner', 'branch:read'),
  ('owner', 'branch:write'),
  ('owner', 'user:read'),
  ('owner', 'user:write'),
  ('owner', 'user:invite'),
  ('owner', 'appointment:read.all'),
  ('owner', 'appointment:write'),
  ('owner', 'appointment:reopen'),
  ('owner', 'service:read'),
  ('owner', 'service:write'),
  ('owner', 'resource:read'),
  ('owner', 'resource:write'),
  ('owner', 'customer:read'),
  ('owner', 'customer:write'),
  ('owner', 'customer.medical:read'),
  ('owner', 'customer.medical:write'),
  ('owner', 'package:read'),
  ('owner', 'package:write'),
  ('owner', 'finance.payment:read'),
  ('owner', 'finance.payment:write'),
  ('owner', 'finance.commission:read'),
  ('owner', 'report.revenue:read'),
  ('owner', 'consent:read'),
  ('owner', 'consent:manage'),
  ('owner', 'notification:send'),
  ('owner', 'audit:read'),
  ('manager', 'tenant:read'),
  ('manager', 'branch:read'),
  ('manager', 'user:read'),
  ('manager', 'user:invite'),
  ('manager', 'appointment:read.all'),
  ('manager', 'appointment:write'),
  ('manager', 'customer:read'),
  ('manager', 'customer:write'),
  ('manager', 'service:read'),
  ('manager', 'resource:read'),
  ('manager', 'package:read'),
  ('manager', 'consent:read'),
  ('manager', 'appointment:reopen'),
  ('manager', 'service:write'),
  ('manager', 'resource:write'),
  ('manager', 'customer.medical:read'),
  ('manager', 'package:write'),
  ('manager', 'finance.payment:read'),
  ('manager', 'finance.payment:write'),
  ('manager', 'finance.commission:read'),
  ('manager', 'report.revenue:read'),
  ('manager', 'consent:manage'),
  ('manager', 'notification:send'),
  ('manager', 'audit:read'),
  ('accountant', 'tenant:read'),
  ('accountant', 'branch:read'),
  ('accountant', 'customer:read'),
  ('accountant', 'package:read'),
  ('accountant', 'finance.payment:read'),
  ('accountant', 'finance.payment:write'),
  ('accountant', 'finance.commission:read'),
  ('accountant', 'report.revenue:read'),
  ('receptionist', 'branch:read'),
  ('receptionist', 'appointment:read.all'),
  ('receptionist', 'appointment:write'),
  ('receptionist', 'customer:read'),
  ('receptionist', 'customer:write'),
  ('receptionist', 'service:read'),
  ('receptionist', 'resource:read'),
  ('receptionist', 'package:read'),
  ('receptionist', 'consent:read'),
  ('receptionist', 'package:write'),
  ('receptionist', 'finance.payment:read'),
  ('receptionist', 'finance.payment:write'),
  ('receptionist', 'consent:manage'),
  ('receptionist', 'notification:send'),
  ('practitioner', 'branch:read'),
  ('practitioner', 'appointment:read.own'),
  ('practitioner', 'appointment:write'),
  ('practitioner', 'customer:read'),
  ('practitioner', 'customer.medical:read'),
  ('practitioner', 'customer.medical:write'),
  ('practitioner', 'service:read'),
  ('practitioner', 'resource:read'),
  ('practitioner', 'package:read'),
  ('practitioner', 'consent:read')
;

-- ---------------------------------------------------------------------------
-- Kullanıcılar
-- ---------------------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  -- Web tarafının birincil giriş tanımlayıcısı. `citext` sayesinde
  -- "Ayse@Klinik.com" ile "ayse@klinik.com" aynı hesaptır.
  email         citext      not null,
  -- Davetle oluşturulan kullanıcıda parola henüz YOKTUR (null); davet kabul
  -- edilene kadar parolayla giriş yapılamaz.
  password_hash text,
  full_name     text        not null check (length(trim(full_name)) > 0),
  locale        text        not null default 'tr-TR',
  is_active     boolean     not null default true,
  -- `logout-all` ve parola değişimi bu sayacı artırır; eski access token'lar
  -- taşıdıkları `tv` claim'i tutmadığı için ilk yetki çözümlemesinde düşer.
  token_version integer     not null default 1,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint users_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Giriş tanımlayıcısı olduğu için YAŞAYAN kullanıcılar arasında tekil.
-- Silinmiş bir hesabın e-postası yeniden kullanılabilir olmalıdır.
create unique index users_email_key on users (email) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Üyelikler: kullanıcı × kiracı × şube × rol
-- ---------------------------------------------------------------------------
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references users(id)   on delete cascade,
  -- Kiracı kapsamlı roller (owner, accountant) için NULL; şube kapsamlı roller
  -- için zorunlu. Kural aşağıdaki trigger ile DB seviyesinde zorlanır.
  branch_id  uuid references branches(id) on delete cascade,
  role_key   text not null references roles(key),
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- `nulls not distinct` (PG15+) olmadan aynı kiracı-genel rol defalarca
  -- eklenebilirdi: NULL branch_id'ler tekillik açısından birbirinden farklı sayılır.
  constraint memberships_unique unique nulls not distinct (tenant_id, user_id, branch_id, role_key)
);

create index memberships_user_idx   on memberships (user_id) where deleted_at is null;
create index memberships_tenant_idx on memberships (tenant_id, user_id) where deleted_at is null;
create index memberships_branch_idx on memberships (branch_id) where deleted_at is null;

/**
 * Rol kapsamı ile şube alanının tutarlılığı.
 *
 * Uygulama katmanında da kontrol edilir; burada tekrar edilmesinin sebebi
 * kuralın veriye ait olmasıdır. "Şube yöneticisi ama hangi şube belli değil"
 * satırı yetki çözümlemesini sessizce bozar — okunan izinler doğru, kapsam
 * tanımsız olur.
 */
create or replace function memberships_validate_scope() returns trigger
language plpgsql as $$
declare
  v_scope       text;
  v_branch_tenant uuid;
begin
  select scope into v_scope from roles where key = new.role_key;

  if v_scope = 'platform' then
    raise exception 'Platform rolü kiracı üyeliği olarak atanamaz (%).', new.role_key
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

-- Trigger yalnız kapsamı belirleyen kolonlar yazıldığında koşar: `is_active`
-- veya `deleted_at` güncellemeleri şube sorgusunu tekrar çalıştırmaz.
create trigger memberships_scope_check
  before insert on memberships
  for each row execute function memberships_validate_scope();

create trigger memberships_scope_check_update
  before update of branch_id, role_key, tenant_id on memberships
  for each row execute function memberships_validate_scope();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table users enable row level security;
alter table users force row level security;

/**
 * Bir kullanıcı satırı üç durumda görünür:
 *   1. Kimlik akışı (giriş / davet / parola sıfırlama) — kiracı henüz belli değil.
 *   2. Kullanıcının kendisi (`/me`).
 *   3. Geçerli kiracıda üyeliği olan biri — personel listesi.
 *
 * Politika `memberships`e başvurur; `memberships` politikası ise `users`a
 * başvurmaz. Döngü yok, dolayısıyla RLS özyineleme hatası da yok.
 */
create policy users_visibility on users
  for select
  using (
    current_auth_flow()
    or id = current_actor_id()
    or exists (
      select 1 from memberships m
       where m.user_id = users.id
         and m.tenant_id = current_tenant_id()
         and m.deleted_at is null
    )
  );

-- Yeni kullanıcı yalnız kimlik akışında (davet kabulü) veya kiracı kurulumunda
-- (platform yöneticisi) oluşur.
create policy users_insert on users
  for insert
  with check (current_auth_flow() or current_setting('app.platform_admin', true) = 'on');

create policy users_update on users
  for update
  using (
    current_auth_flow()
    or id = current_actor_id()
    or exists (
      select 1 from memberships m
       where m.user_id = users.id
         and m.tenant_id = current_tenant_id()
         and m.deleted_at is null
    )
  )
  with check (true);

alter table memberships enable row level security;
alter table memberships force row level security;

-- Okuma kimlik akışında da gerekir: giriş sırasında "bu kullanıcı hangi
-- kiracılarda?" sorusu kiracı context'i OLMADAN cevaplanır.
create policy memberships_read on memberships
  for select
  using (current_auth_flow() or tenant_id = current_tenant_id());

-- Yazım ASLA kimlik akışında yapılmaz. Davet kabulünde bile kiracı context'i
-- önce sabitlenir (invitation.tenant_id), sonra üyelik NORMAL politikadan geçer.
create policy memberships_write on memberships
  for all
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Referans tabloları herkes okur, kimse yazamaz.
alter table roles enable row level security;
alter table roles force row level security;
create policy roles_read on roles for select using (true);

alter table permissions enable row level security;
alter table permissions force row level security;
create policy permissions_read on permissions for select using (true);

alter table role_permissions enable row level security;
alter table role_permissions force row level security;
create policy role_permissions_read on role_permissions for select using (true);

-- ---------------------------------------------------------------------------
-- Trigger'lar ve yetkiler
-- ---------------------------------------------------------------------------
create trigger users_set_updated_at
  before update on users for each row execute function set_updated_at();
create trigger memberships_set_updated_at
  before update on memberships for each row execute function set_updated_at();

-- Parola hash'i denetim kaydına GİRMEZ.
create trigger users_audit
  after insert or update or delete on users
  for each row execute function audit_row_change_redacted('tenant_id', 'password_hash');
create trigger memberships_audit
  after insert or update or delete on memberships
  for each row execute function audit_row_change('tenant_id');

grant select, insert, update, delete on users, memberships to klinara_app;
grant select on roles, permissions, role_permissions to klinara_app;
-- Referans veri uygulama tarafından DEĞİŞTİRİLEMEZ: izin listesini genişleten
-- bir hata, yetki kontrolünü kendi kendine geçersiz kılardı.
revoke insert, update, delete on roles, permissions, role_permissions from klinara_app;

-- Kimlik akışında kiracı adının okunması.
--
-- Giriş sırasında kullanıcıya "hangi kliniğe gireceksin?" diye sorulur; bu liste
-- kiracı adlarını gerektirir ama henüz seçilmiş bir kiracı YOKTUR. Politika
-- bunu mümkün olan en dar biçimde açar: yalnız kimlik akışında ve yalnız
-- AKTÖRÜN ÜYESİ OLDUĞU kiracılar. Kimlik akışı, parola doğrulandıktan sonra
-- `app.user_id`i o kullanıcıya set eder (bkz. TenantTxService.runAsAuth).
create policy tenants_auth_flow_read on tenants
  for select
  using (
    current_auth_flow()
    and exists (
      select 1 from memberships m
       where m.tenant_id = tenants.id
         and m.user_id = current_actor_id()
         and m.deleted_at is null
    )
  );
