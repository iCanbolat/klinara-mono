import { sql, type SQL } from 'drizzle-orm';
import { branchFilterSql } from '../report-scope';

/**
 * Doluluğun PAYDASI: personelin gerçekten müsait olduğu dakikalar.
 *
 * Bu, `availability.repository.ts`'in slot ızgarasından bilerek ayrı bir
 * hesap. Uygunluk motoru "şu hizmet şu anda alınabilir mi" sorusuna cevap
 * verirken slot taneciğine, hizmet süresine ve buffer'lara bakar; doluluk ise
 * "bu personelin bu gün kaç dakikası vardı" diye sorar. Motoru buraya
 * uydurmaya çalışmak, iki farklı soruyu tek sorguya sıkıştırıp ikisini de
 * yanlış cevaplamak olurdu. Ortak olan VERİ kaynağıdır (`branch_hours`,
 * `staff_schedules`, `holidays`, `schedule_exceptions`) ve o kaynaklar tek tek
 * aynı kurallarla okunuyor.
 *
 * Sonuç `tstzmultirange` üzerinden hesaplanıyor. Naif yaklaşım (çalışma
 * dakikaları eksi istisna dakikaları) ÇAKIŞAN iki istisnayı iki kez düşer ve
 * paydayı olduğundan küçük gösterir — yani doluluğu olduğundan yüksek. Çok
 * aralık farkı (`-`) bu hatayı yapısal olarak imkânsız kılıyor.
 */

export interface WorkingMinutesParams {
  /** Yarı açık pencere. */
  from: Date;
  to: Date;
  /** `null` → kiracının tüm şubeleri (yalnız `tenantWide` çağıranlarda oluşur). */
  branchIds: string[] | null;
  /** Doluysa yalnız bu personel. */
  staffProfileId: string | null;
}

/**
 * `report_branches` → `staff_available` zincirini kuran CTE gövdesi.
 *
 * Çağıran bunu bir `with` içine koyup son CTE'lerden okur:
 *
 * - `report_branches (branch_id, timezone, branch_name)`
 * - `staff_available (branch_id, staff_profile_id, local_date, available_minutes)`
 */
export function workingMinutesCtes(params: WorkingMinutesParams): SQL {
  const from = params.from.toISOString();
  const to = params.to.toISOString();
  const staffFilter =
    params.staffProfileId === null
      ? sql`true`
      : sql`ss.staff_profile_id = ${params.staffProfileId}::uuid`;

  return sql`
    report_branches as (
      select b.id as branch_id, b.timezone, b.name as branch_name
        from branches b
       where b.is_active
         and b.deleted_at is null
         and ${branchFilterSql(params.branchIds, sql`b.id`)}
    ),

    -- Pencerenin kapsadığı YEREL günler, şube başına. Şubeler farklı saat
    -- dilimlerinde olabilir ve "1 Eylül" hepsi için aynı ana denk gelmez.
    report_days as (
      select rb.branch_id, rb.timezone,
             d::date as local_date
        from report_branches rb
        cross join generate_series(
               (${from}::timestamptz at time zone rb.timezone)::date,
               (${to}::timestamptz   at time zone rb.timezone)::date,
               interval '1 day'
             ) d
    ),

    -- Günün şube kuralları. Tatil satırı şubenin saatlerini EZER; tatilin
    -- kendi saatleri varsa şubenin mola tanımı da geçersizdir (uygunluk
    -- motorundaki kararın aynısı — kısmi açık bir bayramda öğle molası
    -- varsaymak uydurma olurdu).
    report_branch_days as (
      select rd.branch_id, rd.timezone, rd.local_date,
             coalesce(hol.open_time,  bh.open_time)  as open_time,
             coalesce(hol.close_time, bh.close_time) as close_time,
             case when hol.open_time is null then bh.break_start_time end as break_start_time,
             case when hol.open_time is null then bh.break_end_time   end as break_end_time
        from report_days rd
        join branch_hours bh
          on bh.branch_id = rd.branch_id
         and bh.day_of_week = extract(dow from rd.local_date)::int
         and bh.deleted_at is null
        left join lateral (
          select h.is_closed, h.open_time, h.close_time
            from holidays h
           where h.holiday_date = rd.local_date
             and h.deleted_at is null
             and (h.branch_id = rd.branch_id or h.branch_id is null)
           order by h.branch_id nulls last
           limit 1
        ) hol on true
       where not coalesce(hol.is_closed, bh.is_closed)
         -- Kapalı gün satırlarında saatler NULL; aralık kurulamaz.
         and coalesce(hol.open_time, bh.open_time) is not null
    ),

    -- Personelin o gün çalıştığı aralık: kendi vardiyası ∩ şubenin açık
    -- saatleri. Kesişim ŞART — personel 08:00'de başlıyor ama şube 09:00'da
    -- açıyorsa o bir saat müsait değildir, kimse randevu alamaz.
    report_staff_days as (
      select bd.branch_id, bd.local_date, ss.staff_profile_id,
             tstzrange(
               greatest((bd.local_date + ss.start_time) at time zone bd.timezone,
                        (bd.local_date + bd.open_time)  at time zone bd.timezone),
               least((bd.local_date + ss.end_time)   at time zone bd.timezone,
                     (bd.local_date + bd.close_time) at time zone bd.timezone),
               '[)'
             ) as work_range,
             case
               when bd.break_start_time is not null and bd.break_end_time is not null
               then tstzrange(
                      (bd.local_date + bd.break_start_time) at time zone bd.timezone,
                      (bd.local_date + bd.break_end_time)   at time zone bd.timezone,
                      '[)')
             end as break_range
        from report_branch_days bd
        join staff_schedules ss
          on ss.branch_id = bd.branch_id
         and ss.day_of_week = extract(dow from bd.local_date)::int
         and not ss.is_off
         and ss.deleted_at is null
        join staff_profiles sp
          on sp.id = ss.staff_profile_id
         and sp.is_active
         and sp.deleted_at is null
       where ${staffFilter}
    ),

    -- İzin ve istisnalar, tekrarlılar somut aralıklara açılarak.
    -- availability.repository.ts'teki açılımın çok şubeli hâli.
    report_exceptions as (
      select e.staff_profile_id, e.branch_id,
             tstzrange(e.starts_at, e.ends_at, '[)') as blocked
        from schedule_exceptions e
        join report_branches rb on rb.branch_id = e.branch_id
       where e.is_active
         and e.deleted_at is null
         and e.recurrence_type = 'none'
         and e.starts_at < ${to}::timestamptz
         and e.ends_at   > ${from}::timestamptz

      union all

      select e.staff_profile_id, e.branch_id,
             tstzrange(occ.starts_at, occ.starts_at + (e.ends_at - e.starts_at), '[)') as blocked
        from schedule_exceptions e
        join report_branches rb on rb.branch_id = e.branch_id
        cross join lateral (
          select ((d::date + (e.starts_at at time zone rb.timezone)::time) at time zone rb.timezone)
                   as starts_at
            from generate_series(
                   greatest(
                     date_trunc('day', ${from}::timestamptz at time zone rb.timezone),
                     date_trunc('day', e.starts_at at time zone rb.timezone)
                   ),
                   least(
                     date_trunc('day', ${to}::timestamptz at time zone rb.timezone),
                     date_trunc('day', e.recurrence_until at time zone rb.timezone)
                   ),
                   interval '1 day'
                 ) d
           where extract(dow from d)::int = any(e.recurrence_weekdays)
             and (
               floor(
                 extract(epoch from (
                   date_trunc('week', d) -
                   date_trunc('week', e.starts_at at time zone rb.timezone)
                 )) / 604800
               )::int % e.recurrence_interval_weeks
             ) = 0
        ) occ
       where e.is_active
         and e.deleted_at is null
         and e.recurrence_type = 'weekly'
    ),

    -- Çalışma aralığı eksi mola eksi istisnalar, sonra sorgu penceresine
    -- kırpılır. Fark ÇOK ARALIK (tstzmultirange) üzerinde: iki istisna
    -- çakışırsa kesişen dakika bir kez düşer, iki kez değil.
    staff_available as (
      select sd.branch_id,
             sd.staff_profile_id,
             sd.local_date,
             coalesce(
               (select sum(extract(epoch from (upper(part) - lower(part))) / 60)
                  from unnest(
                         (
                           multirange(sd.work_range)
                           * multirange(tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)'))
                           - coalesce(multirange(sd.break_range), '{}'::tstzmultirange)
                           - coalesce(
                               (select range_agg(ex.blocked)
                                  from report_exceptions ex
                                 where ex.staff_profile_id = sd.staff_profile_id
                                   and ex.branch_id = sd.branch_id
                                   and ex.blocked && sd.work_range),
                               '{}'::tstzmultirange)
                         )
                       ) as part),
               0)::numeric as available_minutes
        from report_staff_days sd
       -- Pencereyle KESİŞMEYEN gün hiç satır üretmemeli. report_days
       -- serisi bitiş gününü de kapsıyor (yarı açık aralığın dışında kalan
       -- gün) ve bu satırlar kırpıldıktan sonra sıfır dakikayla hayatta
       -- kalıyordu: raporda "0 dk müsait" diye bir gün belirir, izin günüyle
       -- karışırdı.
       where not isempty(sd.work_range)
         and sd.work_range && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')
    )
  `;
}

/**
 * Doluluğun PAYI: `resource_bookings` üzerindeki gerçek işgal.
 *
 * `hold` satırları SAYILMAZ — geçici bir tutma, yapılmış bir iş değil.
 * `active = false` (iptal, no-show sonrası serbest bırakılan) da sayılmaz.
 *
 * Aralık buffer'ları İÇERİR ve bu kasıtlı: hazırlık ve temizlik payı o
 * personelin başka randevu alamadığı gerçek dakikalardır. Yalnız hizmet
 * süresini saymak, doluluğu sistematik olarak olduğundan düşük gösterirdi.
 *
 * Gece yarısını aşan bir aralık TAMAMEN başladığı güne yazılır. Bölmek
 * gerekmiyor: `branch_hours` açılış ve kapanışı aynı günün `time` kolonlarında
 * tutuyor (`open_time < close_time`), yani çalışma saatleri içinde kalan bir
 * randevu geceyi aşamaz. Aşan bir kayıt varsa o zaten mesai dışı bir override
 * demektir ve onu iki güne bölmek doluluğu netleştirmez.
 *
 * Sonuç `booked (branch_id, staff_profile_id, local_date, booked_minutes)`.
 */
export function bookedMinutesCte(params: WorkingMinutesParams): SQL {
  const from = params.from.toISOString();
  const to = params.to.toISOString();
  const staffFilter =
    params.staffProfileId === null
      ? sql`true`
      : sql`rb.resource_id = ${params.staffProfileId}::uuid`;

  return sql`
    booked as (
      select rb.branch_id,
             rb.resource_id as staff_profile_id,
             (lower(clipped.range) at time zone br.timezone)::date as local_date,
             sum(extract(epoch from (upper(clipped.range) - lower(clipped.range))) / 60)::numeric
               as booked_minutes
        from resource_bookings rb
        join report_branches br on br.branch_id = rb.branch_id
        cross join lateral (
          select rb.time_range * tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)') as range
        ) clipped
       where rb.active
         and rb.resource_type = 'staff'
         and rb.source_type = 'appointment'
         and not isempty(clipped.range)
         and ${staffFilter}
       group by 1, 2, 3
    )
  `;
}
