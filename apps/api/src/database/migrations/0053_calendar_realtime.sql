-- Takvimin canlı tazelenmesi: randevu satırı değişince açık takvimlere sinyal.
--
-- Yayın TRIGGER'dan, servis kodundan DEĞİL: randevuya dokunan yol tek değil
-- (panel, online randevu, self-servis, WhatsApp onay düğmesi, kuyruk
-- işleri). Her birine `publish` eklemek bir gün birinin unutulması demekti;
-- tablo düzeyinde sinyal hiçbir yolu kaçırmaz.
--
-- Aynı atomiklik: `pg_notify` yalnız COMMIT'te teslim edilir, rollback olan
-- randevu sinyal üretmez. Aynı transaction'daki birebir aynı yükler Postgres
-- tarafından tek bildirime indirgenir.
--
-- Yük İÇERİK TAŞIMAZ: hangi şube, hangi yerel günler. Müşteri, hizmet ya da
-- saat yok; istemci etkilenen günü ekranda tutuyorsa veriyi yetkili REST
-- ucundan yeniden okur. Kanal ve yük biçimi `RealtimeBusService` ile aynı.

create or replace function appointments_notify_calendar() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tz   text;
  v_days text[];
begin
  select b.timezone into v_tz from branches b where b.id = new.branch_id;
  v_tz := coalesce(v_tz, 'Europe/Istanbul');

  v_days := array[to_char(new.starts_at at time zone v_tz, 'YYYY-MM-DD')];
  -- Erteleme iki günü birden etkiler: randevunun ayrıldığı ve vardığı gün.
  if tg_op = 'UPDATE' and old.starts_at is distinct from new.starts_at then
    v_days := v_days || to_char(old.starts_at at time zone v_tz, 'YYYY-MM-DD');
  end if;

  perform pg_notify('klinara_realtime', json_build_object(
    'tenantId', new.tenant_id,
    'branchId', new.branch_id,
    'type',     'calendar_changed',
    'days',     (select to_json(array_agg(distinct d order by d)) from unnest(v_days) d)
  )::text);
  return null;
end $$;

revoke execute on function appointments_notify_calendar() from public;

create trigger appointments_notify_calendar_insert
  after insert on appointments
  for each row execute function appointments_notify_calendar();

-- Değişmeyen bir UPDATE (aynı değerlerle yazım) sinyal üretmesin.
create trigger appointments_notify_calendar_update
  after update on appointments
  for each row when (old.* is distinct from new.*)
  execute function appointments_notify_calendar();
