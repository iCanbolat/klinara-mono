-- Mobil push bildirimleri — personel cihazları (APNs / FCM).
--
-- Cihaz bir OTURUMA bağlıdır, kullanıcıya değil: çıkış yapılan ya da iptal
-- edilen oturumun cihazına bildirim gitmez. Aynı telefonda başka bir kullanıcı
-- giriş yaparsa cihaz anahtarı ona geçer (`token` tekil): bir önceki
-- kullanıcının bildirimleri yeni kullanıcının kilit ekranına düşmemeli.
--
-- Push bir YAN KANAL: içerik `staff_notifications`ta, bildirim yalnız
-- "panelde bir şey var" der. Metne müşteri ya da hizmet adı yazılmaz
-- (kilit ekranında sağlık verisi görünmemeli) — bkz. `PushWorker`.

create type push_platform as enum ('ios', 'android');
-- APNs geliştirme (Xcode'dan kurulan) ve canlı (TestFlight/App Store)
-- derlemeleri AYRI uç noktalara gider; FCM'de ayrım yok.
create type push_environment as enum ('sandbox', 'production');

create table push_devices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id)  on delete cascade,
  user_id      uuid not null references users(id)    on delete cascade,
  session_id   uuid not null references sessions(id) on delete cascade,
  platform     push_platform not null,
  environment  push_environment not null default 'production',
  token        text not null check (length(token) between 1 and 4096),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_devices_token_unique unique (token)
);

create index push_devices_tenant_idx on push_devices (tenant_id);
create index push_devices_session_idx on push_devices (session_id);

alter table push_devices enable row level security;
alter table push_devices force row level security;
-- Kullanıcı yalnız KENDİ cihazlarını görür. Alıcı listesi ve geçersiz
-- anahtar temizliği aşağıdaki `security definer` fonksiyonlardan geçer.
create policy push_devices_own on push_devices
  using (tenant_id = current_tenant_id() and user_id = current_actor_id())
  with check (tenant_id = current_tenant_id() and user_id = current_actor_id());

grant select, delete on push_devices to klinara_app;
revoke insert, update on push_devices from klinara_app;

-- ---------------------------------------------------------------------------
-- Kayıt: anahtar başka bir kullanıcıdaysa ona ait satır silinir.
-- ---------------------------------------------------------------------------
-- Bu yüzden `security definer`: RLS ötekinin satırını göremez. Kimlik
-- parametreden DEĞİL bağlamdan okunur — çağıran başkası adına kayıt yapamaz.
create or replace function register_push_device(
  p_session_id  uuid,
  p_platform    push_platform,
  p_environment push_environment,
  p_token       text
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := current_actor_id();
begin
  if v_tenant is null or v_user is null then
    raise exception 'Cihaz kaydı kiracı ve kullanıcı bağlamı ister'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from sessions s
     where s.id = p_session_id and s.user_id = v_user and s.tenant_id = v_tenant
       and s.revoked_at is null and s.expires_at > now()
  ) then
    raise exception 'Oturum geçerli değil' using errcode = 'insufficient_privilege';
  end if;

  delete from push_devices
   where token = p_token
     and (user_id <> v_user or tenant_id <> v_tenant or session_id <> p_session_id);

  -- Bir oturumun tek cihazı vardır: uygulama yeni anahtar aldıysa eskisi ölüdür.
  delete from push_devices where session_id = p_session_id and token <> p_token;

  insert into push_devices (tenant_id, user_id, session_id, platform, environment, token)
  values (v_tenant, v_user, p_session_id, p_platform, p_environment, p_token)
  on conflict (token) do update
     set platform = excluded.platform,
         environment = excluded.environment,
         last_seen_at = now();
end $$;

revoke execute on function register_push_device(uuid, push_platform, push_environment, text) from public;
grant execute on function register_push_device(uuid, push_platform, push_environment, text) to klinara_app;

-- ---------------------------------------------------------------------------
-- Alıcılar: bildirimi görme yetkisi olan, oturumu yaşayan cihazlar.
-- ---------------------------------------------------------------------------
-- Kural `GET staff-notifications` ile aynı: `notification:read` izni ve şube
-- erişimi (`p_branch_id` null ise klinik geneli). Kiracı bağlamdan okunur.
create or replace function push_recipients(p_branch_id uuid)
returns table (id uuid, platform push_platform, environment push_environment, token text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select d.id, d.platform, d.environment, d.token
    from push_devices d
    join sessions s on s.id = d.session_id
    join users u on u.id = d.user_id
   where d.tenant_id = current_tenant_id()
     and s.revoked_at is null
     and s.expires_at > now()
     and u.is_active
     and exists (
       select 1
         from memberships m
         join role_permissions rp on rp.role_key = m.role_key
        where m.tenant_id = d.tenant_id
          and m.user_id = d.user_id
          and m.is_active
          and m.deleted_at is null
          and rp.permission_key = 'notification:read'
          and (p_branch_id is null or m.branch_id is null or m.branch_id = p_branch_id)
     )
$$;

revoke execute on function push_recipients(uuid) from public;
grant execute on function push_recipients(uuid) to klinara_app;

-- APNs/FCM "bu anahtar artık yok" dediğinde. Yalnız bağlamdaki kiracının satırları.
create or replace function forget_push_devices(p_ids uuid[]) returns void
language sql security definer set search_path = pg_catalog, public as $$
  delete from push_devices where tenant_id = current_tenant_id() and id = any(p_ids)
$$;

revoke execute on function forget_push_devices(uuid[]) from public;
grant execute on function forget_push_devices(uuid[]) to klinara_app;
