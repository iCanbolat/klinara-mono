-- Faz 2 staff-only kapsamı için izin sözleşmesi güncellemesi.
--
-- Not: resource:* anahtarları geçmiş sözleşme uyumu için korunur.
-- Yeni uçlar staff:* ve schedule:* kullanır.

insert into permissions (key, description) values
  ('staff:read',      'Personel profili ve yetkinliklerini görüntüleme'),
  ('staff:write',     'Personel profili ve yetkinliklerini düzenleme'),
  ('schedule:read',   'Çalışma saatleri ve istisnaları görüntüleme'),
  ('schedule:write',  'Çalışma saatleri ve istisnaları düzenleme')
on conflict (key) do update
  set description = excluded.description;

-- Manager / receptionist / practitioner artık resource:* yerine
-- staff:* ve schedule:* üzerinden yetkilendirilir.
delete from role_permissions
 where (role_key, permission_key) in (
   ('manager', 'resource:read'),
   ('manager', 'resource:write'),
   ('receptionist', 'resource:read'),
   ('practitioner', 'resource:read')
 );

insert into role_permissions (role_key, permission_key) values
  ('owner', 'staff:read'),
  ('owner', 'staff:write'),
  ('owner', 'schedule:read'),
  ('owner', 'schedule:write'),
  ('manager', 'staff:read'),
  ('manager', 'staff:write'),
  ('manager', 'schedule:read'),
  ('manager', 'schedule:write'),
  ('receptionist', 'staff:read'),
  ('receptionist', 'schedule:read'),
  ('practitioner', 'staff:read'),
  ('practitioner', 'schedule:read')
on conflict do nothing;
