-- Denetim kaydı (audit log).
--
-- Tek bir generic trigger tüm tabloları kapsar; aktörü ve istek kimliğini
-- transaction'a yazılmış session ayarlarından okur. Böylece "kim, ne zaman,
-- neyi değiştirdi" sorusu uygulama koduna güvenmeden cevaplanabilir.
create table audit_log (
  id             bigserial primary key,
  tenant_id      uuid,
  actor_user_id  uuid,
  table_name     text        not null,
  record_id      uuid,
  action         text        not null check (action in ('insert', 'update', 'delete')),
  old_data       jsonb,
  new_data       jsonb,
  request_id     text,
  created_at     timestamptz not null default now()
);

create index audit_log_tenant_created_idx on audit_log (tenant_id, created_at desc);
create index audit_log_record_idx on audit_log (table_name, record_id, created_at desc);

alter table audit_log enable row level security;
alter table audit_log force row level security;

create policy audit_log_tenant_read on audit_log
  for select
  using (
    tenant_id = current_tenant_id()
    or current_setting('app.platform_admin', true) = 'on'
  );

-- INSERT politikası ŞART.
--
-- `force row level security` tablo SAHİBİNİ de politikalara tabi kılar. Denetim
-- trigger'ı SECURITY DEFINER olduğu için sahibin haklarıyla koşar; INSERT
-- politikası olmadan bu yazım REDDEDİLİR ve trigger AFTER olduğundan asıl iş
-- yazımı da komple başarısız olur.
--
-- Bu hata yerel/test ortamında GÖRÜNMEZ: oradaki sahip rol çoğu zaman
-- superuser'dır ve superuser RLS'i her hâlükârda bypass eder. Üretimde sahip
-- rol superuser olmadığında ise sistem tamamen yazma yapamaz hâle gelir.
-- Aşağıdaki test (`denetim trigger'ı superuser OLMAYAN sahiple de yazabilmeli`)
-- bu durumu bilerek taklit eder.
--
-- `with check (true)` güvenlidir: `klinara_app` rolüne audit_log üzerinde INSERT
-- yetkisi verilmez, dolayısıyla tek yazan yol trigger'dır.
create policy audit_log_trigger_insert on audit_log
  for insert
  with check (true);

-- Denetim kaydı değiştirilemez ve silinemez: kanıt niteliğindedir.
create trigger audit_log_immutable
  before update or delete on audit_log
  for each row execute function reject_mutation();

/**
 * Generic denetim trigger'ı.
 *
 * TG_ARGV[0] ile kiracı kolonunun adı verilir (varsayılan 'tenant_id').
 * `tenants` tablosunda kiracı kimliği 'id' kolonundadır, bu yüzden orada
 * 'id' geçilir.
 *
 * SECURITY DEFINER: denetim kaydı yazımı RLS tarafından ENGELLENEMEZ. Aksi
 * hâlde bir kullanıcı, kendi context'i dışındaki bir yazımı loglatmayarak iz
 * bırakmadan işlem yapabilirdi.
 */
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_record   jsonb;
  v_tenant_col text := coalesce(tg_argv[0], 'tenant_id');
  v_tenant   uuid;
  v_record_id uuid;
begin
  v_record := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  v_tenant := coalesce(
    nullif(v_record ->> v_tenant_col, '')::uuid,
    current_tenant_id()
  );
  v_record_id := nullif(v_record ->> 'id', '')::uuid;

  insert into audit_log (
    tenant_id, actor_user_id, table_name, record_id, action, old_data, new_data, request_id
  ) values (
    v_tenant,
    current_actor_id(),
    tg_table_name,
    v_record_id,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    current_request_id()
  );

  return case when tg_op = 'DELETE' then old else new end;
end $$;
