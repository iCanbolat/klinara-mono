import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';

export interface AvailabilityQuery {
  branchId: string;
  serviceIds: string[];
  from: Date;
  to: Date;
  staffProfileId?: string | undefined;
  slotGranularityMinutes: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
  /** Şimdi — testlerin sabit bir "an" verebilmesi için parametre. */
  now: Date;
}

/** Ham sorgu satırı — kolon adları SQL'deki gibi snake_case. */
export interface AvailabilitySlotRow extends Record<string, unknown> {
  slot_start: Date;
  visible_end: Date;
  staff_profile_ids: string[];
}

/**
 * Uygunluk motoru — TEK sorgu.
 *
 * Neden tek sorgu: her filtreyi ayrı çekip JS'te kesiştirmek, 30 günlük bir
 * pencerede binlerce satırı ağdan taşımak ve `resource_bookings` üzerindeki
 * GiST indeksini hiç kullanmamak demekti. Zincirin tamamı veritabanında
 * kalınca indeksler devrede olur ve sonuç tek gidiş-dönüşte döner.
 *
 * ZAMAN DİLİMİ: tüm gün/saat kararları `at time zone <şube tz>` ile ANLIK
 * bazında verilir. Sabit bir UTC offset'i hiçbir yerde varsayılmaz; yaz saati
 * geçişinde "09:00" o günün gerçek 09:00'ıdır. Türkiye kalıcı UTC+3'tedir ama
 * kural motorun özelliğidir, ülkenin değil — farklı saat dilimindeki şubeler
 * aynı kiracıda yaşayabilir.
 *
 * MVP SINIRI: çok hizmetli (ardışık) randevuda blok TEK personele verilir.
 * Hizmetleri farklı personele bölmek ayrı bir üründür ve aday kümesi
 * semantiğini değiştirir; Faz 9 sonrası değerlendirilecek.
 */
export async function findAvailableSlots(
  tx: Tx,
  query: AvailabilityQuery,
): Promise<AvailabilitySlotRow[]> {
  const result = await tx.execute<AvailabilitySlotRow>(buildAvailabilityQuery(query));
  return result.rows;
}

/**
 * Sorgunun kendisi — ayrı fonksiyon, çünkü testler onu `explain (analyze)`
 * içine sarabilmeli. Plan regresyonu (indeksin bir gün kullanılmaz olması)
 * ancak böyle yakalanır.
 */
export function buildAvailabilityQuery(query: AvailabilityQuery): SQL {
  const serviceCount = query.serviceIds.length;

  return sql`
    with branch as (
      select b.id, b.timezone
        from branches b
       where b.id = ${query.branchId}
         and b.is_active
         and b.deleted_at is null
    ),

    -- Sorgu penceresindeki YEREL günler. Gün kuralları (açık/kapalı, saatler,
    -- mola, tatil) burada BİR KEZ çözülür. Slot başına çözmek, 30 günlük bir
    -- pencerede aynı tatil satırını binlerce kez okumak demekti.
    days as (
      select d::date as local_date
        from branch b,
             generate_series(
               date_trunc('day', ${query.from.toISOString()}::timestamptz at time zone b.timezone),
               date_trunc('day', ${query.to.toISOString()}::timestamptz   at time zone b.timezone),
               interval '1 day'
             ) d
    ),

    day_rules as (
      select days.local_date,
             coalesce(hol.open_time,  bh.open_time)  as open_time,
             coalesce(hol.close_time, bh.close_time) as close_time,
             -- Tatilin kendi saatleri varsa şubenin mola tanımı geçersizdir.
             case when hol.open_time is null then bh.break_start_time end as break_start_time,
             case when hol.open_time is null then bh.break_end_time   end as break_end_time,
             extract(dow from days.local_date)::int as day_of_week
        from days
        join branch_hours bh
          on bh.branch_id = ${query.branchId}
         and bh.day_of_week = extract(dow from days.local_date)::int
         and bh.deleted_at is null
        left join lateral (
          select h.is_closed, h.open_time, h.close_time
            from holidays h
           where h.holiday_date = days.local_date
             and h.deleted_at is null
             and (h.branch_id = ${query.branchId} or h.branch_id is null)
           order by h.branch_id nulls last
           limit 1
        ) hol on true
       where not coalesce(hol.is_closed, bh.is_closed)
    ),

    -- İstenen hizmetler, GÖNDERİLEN SIRAYLA. Sıra önemlidir: ilk hizmetin
    -- hazırlık payı bloğun önüne, son hizmetin temizlik payı arkasına düşer.
    requested as (
      select service_id, ordinality as ord
        -- Diziyi TEK bir metin parametresi olarak taşıyoruz. Drizzle bir JS
        -- dizisini ayrı ayrı parametrelere açıyor; string_to_array ile hem
        -- bağlama tek parametreye iniyor hem de enjeksiyon yüzeyi kalmıyor.
        from unnest(string_to_array(${query.serviceIds.join(',')}, ',')::uuid[])
             with ordinality as t(service_id, ordinality)
    ),

    -- Personel × hizmet: süre ve buffer'ın ÇÖZÜMLENMESİ.
    -- Öncelik: personelin özel süresi → şube override'ı → hizmetin kendisi.
    -- "distinct on" ile şubeye özel yetkinlik satırı, kiracı geneli satırı yener.
    resolved as (
      select distinct on (ss.staff_profile_id, r.ord)
             ss.staff_profile_id,
             r.ord,
             coalesce(ss.custom_duration_minutes, bso.duration_minutes, s.duration_minutes)
               as duration_minutes,
             coalesce(bso.buffer_before_minutes, s.buffer_before_minutes) as buffer_before,
             coalesce(bso.buffer_after_minutes,  s.buffer_after_minutes)  as buffer_after
        from requested r
        join services s
          on s.id = r.service_id and s.is_active and s.deleted_at is null
        join staff_services ss
          on ss.service_id = s.id
         and ss.is_active
         and ss.deleted_at is null
         and (ss.branch_id is null or ss.branch_id = ${query.branchId})
        join staff_profiles sp
          on sp.id = ss.staff_profile_id
         and sp.is_active
         and sp.deleted_at is null
        left join branch_service_overrides bso
          on bso.service_id = s.id
         and bso.branch_id = ${query.branchId}
         and bso.deleted_at is null
         and coalesce(bso.is_active, true)
       where (${query.staffProfileId ?? null}::uuid is null
              or ss.staff_profile_id = ${query.staffProfileId ?? null}::uuid)
       order by ss.staff_profile_id, r.ord, ss.branch_id nulls last
    ),

    -- Yalnız İSTENEN HİZMETLERİN TAMAMINDA yetkin personel aday olabilir.
    capable as materialized (
      select staff_profile_id,
             sum(buffer_before + duration_minutes + buffer_after)::int as occupied_minutes,
             (array_agg(buffer_before order by ord))[1]::int            as lead_before,
             (array_agg(buffer_after  order by ord desc))[1]::int       as trail_after
        from resolved
       group by staff_profile_id
      having count(*) = ${serviceCount}
    ),

    -- Slot ızgarası, personelle ÇARPILMADAN önce elenir: günün açık saatleri
    -- dışındaki noktalar buradan hiç çıkmaz.
    open_slots as (
      select gs as slot_start,
             (gs at time zone b.timezone) as local_start,
             dr.open_time, dr.close_time, dr.break_start_time, dr.break_end_time,
             dr.day_of_week
        -- Virgülle değil AÇIK cross join: virgül JOIN'den daha gevşek bağlar
        -- ve b alias'ı sonraki ON yan tümcesinde görünmez olurdu.
        from branch b
        cross join generate_series(
               ${query.from.toISOString()}::timestamptz,
               ${query.to.toISOString()}::timestamptz,
               make_interval(mins => ${query.slotGranularityMinutes})
             ) gs
        join day_rules dr
          on dr.local_date = (gs at time zone b.timezone)::date
       where (gs at time zone b.timezone)::time >= dr.open_time
         and (gs at time zone b.timezone)::time <  dr.close_time
         and gs >= ${query.now.toISOString()}::timestamptz
                   + make_interval(mins => ${query.minLeadMinutes})
         and gs <= ${query.now.toISOString()}::timestamptz
                   + make_interval(days => ${query.maxAdvanceDays})
    ),

    -- Tekrarlı istisnaların somut aralıklara AÇILMASI.
    -- Haftalık tekrar, günü şube saat diliminde üretip aynı yerel saati
    -- uygular; böylece yaz saati geçişinde "her salı 14:00" gerçekten 14:00
    -- kalır, bir saat kaymaz.
    expanded_exceptions as (
      select e.staff_profile_id,
             tstzrange(e.starts_at, e.ends_at, '[)') as blocked
        from schedule_exceptions e
       where e.is_active
         and e.deleted_at is null
         and e.branch_id = ${query.branchId}
         and e.recurrence_type = 'none'
         and e.starts_at < ${query.to.toISOString()}::timestamptz
         and e.ends_at   > ${query.from.toISOString()}::timestamptz

      union all

      select e.staff_profile_id,
             tstzrange(occ.starts_at, occ.starts_at + (e.ends_at - e.starts_at), '[)') as blocked
        from schedule_exceptions e
        join branch b on true
        cross join lateral (
          select ((d::date + (e.starts_at at time zone b.timezone)::time) at time zone b.timezone)
                   as starts_at
            from generate_series(
                   greatest(
                     date_trunc('day', ${query.from.toISOString()}::timestamptz at time zone b.timezone),
                     date_trunc('day', e.starts_at at time zone b.timezone)
                   ),
                   least(
                     date_trunc('day', ${query.to.toISOString()}::timestamptz at time zone b.timezone),
                     date_trunc('day', e.recurrence_until at time zone b.timezone)
                   ),
                   interval '1 day'
                 ) d
           where extract(dow from d)::int = any(e.recurrence_weekdays)
             -- Kaçıncı hafta: ilk oluşumun haftasından itibaren sayılır.
             and (
               floor(
                 extract(epoch from (
                   date_trunc('week', d) -
                   date_trunc('week', e.starts_at at time zone b.timezone)
                 )) / 604800
               )::int % e.recurrence_interval_weeks
             ) = 0
        ) occ
       where e.is_active
         and e.deleted_at is null
         and e.branch_id = ${query.branchId}
         and e.recurrence_type = 'weekly'
    ),

    -- MATERYALİZE ŞART. Aralık ve yerel saat ifadeleri burada aday başına BİR
    -- kez hesaplanır. Inline edildiğinde planlayıcı bunları anti-join
    -- filtresinin içine taşıyor ve her karşılaştırmada yeniden çalıştırıyor.
    -- Mevcut işgal, YEREL GÜN anahtarıyla etiketlenmiş hâlde.
    --
    -- Gün anahtarı olmadan anti-join yalnız personel kimliğinde eşleşiyor ve
    -- her aday, o personelin penceredeki TÜM kayıtlarıyla karşılaştırılıyordu
    -- (ölçüldü: 470 binden fazla karşılaştırma). Gün de anahtara girince
    -- karşılaştırma yalnız aynı güne düşer.
    --
    -- Gece yarısını aşan bir aralık İKİ gün altında da üretilir; aksi hâlde
    -- 23:30–00:30 arası bir kayıt ertesi günün ilk slotunu serbest gösterirdi.
    busy as materialized (
      select rb.resource_id,
             d::date as local_day,
             rb.time_range
        from branch b
        cross join resource_bookings rb
        cross join lateral generate_series(
               date_trunc('day', lower(rb.time_range) at time zone b.timezone),
               date_trunc('day', (upper(rb.time_range) - interval '1 microsecond')
                                 at time zone b.timezone),
               interval '1 day'
             ) d
       where rb.active
         and rb.time_range && tstzrange(
               ${query.from.toISOString()}::timestamptz,
               ${query.to.toISOString()}::timestamptz,
               '[)'
             )
    ),

    candidate as materialized (
      select os.slot_start,
             os.local_start,
             c.staff_profile_id,
             tstzrange(
               os.slot_start - make_interval(mins => c.lead_before),
               os.slot_start - make_interval(mins => c.lead_before)
                 + make_interval(mins => c.occupied_minutes),
               '[)'
             ) as occupied_range,
             os.slot_start - make_interval(mins => c.lead_before)
               + make_interval(mins => c.occupied_minutes - c.trail_after) as visible_end,
             (
               os.slot_start - make_interval(mins => c.lead_before)
                 + make_interval(mins => c.occupied_minutes - c.trail_after)
             ) at time zone b.timezone as local_end,
             os.local_start::date as local_day,
             os.open_time, os.close_time, os.break_start_time, os.break_end_time,
             os.day_of_week
        from open_slots os
        cross join capable c
        join branch b on true
    )

    select cd.slot_start,
           cd.visible_end,
           array_agg(cd.staff_profile_id order by cd.staff_profile_id)::text[] as staff_profile_ids
      from candidate cd
      join staff_schedules sch
        on sch.staff_profile_id = cd.staff_profile_id
       and sch.branch_id = ${query.branchId}
       and sch.day_of_week = cd.day_of_week
       and sch.deleted_at is null
       and not sch.is_off
     where
       -- Blok istenen pencerenin DIŞINA taşamaz.
       cd.visible_end <= ${query.to.toISOString()}::timestamptz
       -- Tek bir yerel güne sığmalı (gece yarısını aşan randevu yok).
       and cd.local_start::date = (cd.local_end - interval '1 microsecond')::date
       -- Kapanış saati ve mola.
       and cd.local_end::time <= cd.close_time
       and (
         cd.break_start_time is null
         or not (cd.local_start::time < cd.break_end_time
                 and cd.local_end::time > cd.break_start_time)
       )
       -- Personelin o günkü çalışma penceresi.
       and cd.local_start::time >= sch.start_time
       and cd.local_end::time   <= sch.end_time
       -- İzin/istisna (tekrarlılar açılmış hâlde).
       and not exists (
         select 1
           from expanded_exceptions ex
          where ex.staff_profile_id = cd.staff_profile_id
            and ex.blocked && cd.occupied_range
       )
       -- Mevcut işgal. Anahtar (personel, yerel gün); aralık kesişimi yalnız
       -- aynı güne düşen az sayıda kayıt için değerlendirilir.
       and not exists (
         select 1
           from busy
          where busy.resource_id = cd.staff_profile_id
            and busy.local_day   = cd.local_day
            and busy.time_range  && cd.occupied_range
       )
     group by cd.slot_start, cd.visible_end
     order by cd.slot_start
  `;
}
