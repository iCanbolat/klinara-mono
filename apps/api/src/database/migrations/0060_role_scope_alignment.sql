-- Rol kapsamı hizalaması.
--
-- 1. Paket TANIMI ayrı izne çıkar (`package_definition:write`): resepsiyon
--    paketi satar (`package:write`) ama tanımı (fiyat, seans kuralı) yalnız
--    işletme sahibi ve şube yöneticisi değiştirir.
-- 2. Online randevu sayfası ve içeriği YALNIZ işletme sahibinde: kiracının
--    dışarıya görünen yüzü şube düzeyinde değiştirilmez.
-- 3. Push alıcıları zil akışıyla aynı kurala geçer: şube, mesajlaşma izni ve
--    `appointment:read.all` yoksa yalnız kendi randevusu.

insert into permissions (key, description) values
  ('package_definition:write', 'Paket tanımı oluşturma ve düzenleme')
on conflict (key) do update set description = excluded.description;

insert into role_permissions (role_key, permission_key) values
  ('owner',   'package_definition:write'),
  ('manager', 'package_definition:write')
on conflict do nothing;

delete from role_permissions
 where (role_key = 'manager' and permission_key in ('booking_page:read', 'booking_page:manage'))
    or (role_key = 'receptionist' and permission_key = 'booking_page:read');

drop function if exists push_recipients(uuid);

create or replace function push_recipients(
  p_branch_id uuid,
  p_kind staff_notification_kind,
  p_appointment_id uuid
)
returns table (id uuid, platform push_platform, environment push_environment, token text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with perms as (
    select m.user_id,
           bool_or(m.branch_id is null) as tenant_wide,
           array_remove(array_agg(m.branch_id), null) as branch_ids,
           bool_or(rp.permission_key = 'notification:read') as can_read,
           bool_or(rp.permission_key = 'notification:send') as can_send,
           bool_or(rp.permission_key = 'appointment:read.all') as reads_all
      from memberships m
      join role_permissions rp on rp.role_key = m.role_key
     where m.tenant_id = current_tenant_id()
       and m.is_active
       and m.deleted_at is null
     group by m.user_id
  )
  select d.id, d.platform, d.environment, d.token
    from push_devices d
    join sessions s on s.id = d.session_id
    join users u on u.id = d.user_id
    join perms p on p.user_id = d.user_id
   where d.tenant_id = current_tenant_id()
     and s.revoked_at is null
     and s.expires_at > now()
     and u.is_active
     and p.can_read
     and (p_branch_id is null or p.tenant_wide or p_branch_id = any(p.branch_ids))
     and (p_kind not in ('inbound_message', 'delivery_failed') or p.can_send)
     and (
       p.reads_all
       or p_appointment_id is null
       or exists (
         select 1 from appointment_services a
           join staff_profiles sp on sp.id = a.staff_profile_id
          where a.appointment_id = p_appointment_id
            and sp.user_id = d.user_id
       )
     )
$$;

revoke execute on function push_recipients(uuid, staff_notification_kind, uuid) from public;
grant execute on function push_recipients(uuid, staff_notification_kind, uuid) to klinara_app;
