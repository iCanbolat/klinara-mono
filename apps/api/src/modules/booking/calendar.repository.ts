import { sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';

/**
 * Takvim okumaları — TEK sorgu, N+1 yok.
 *
 * Randevu kalemleri `json_agg` ile aynı sorguda toplanır. Kalemleri ikinci bir
 * sorguyla çekmek 500 randevuluk bir haftada 501 sorgu demekti; kabul kriteri
 * (p95 < 150 ms) böyle bir tasarımla karşılanamaz.
 */

export interface CalendarRow extends Record<string, unknown> {
  id: string;
  branch_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  status: string;
  starts_at: Date;
  ends_at: Date;
  notes: string | null;
  version: number;
  total_minor: string | number;
  services: {
    id: string;
    serviceId: string;
    serviceName: string;
    staffProfileId: string;
    sortOrder: number;
    startsAt: string;
    endsAt: string;
    priceMinor: number;
  }[];
}

export interface CalendarFilters {
  branchId?: string | undefined;
  from: Date;
  to: Date;
  staffProfileId?: string | undefined;
  customerId?: string | undefined;
  statuses?: string[] | undefined;
  /** Dolu ise sonuç YALNIZ bu personelin kalemlerini içeren randevulara daralır. */
  restrictToStaffProfileId?: string | undefined;
  limit: number;
  cursorStartsAt?: string | undefined;
  cursorId?: string | undefined;
}

export async function listCalendar(tx: Tx, filters: CalendarFilters): Promise<CalendarRow[]> {
  const statuses = filters.statuses?.join(',') ?? null;

  const result = await tx.execute<CalendarRow>(sql`
    select a.id::text,
           a.branch_id::text,
           a.customer_id::text,
           c.full_name as customer_name,
           c.phone     as customer_phone,
           a.status::text,
           a.starts_at,
           a.ends_at,
           a.notes,
           a.version,
           coalesce(sum(asv.price_minor), 0) as total_minor,
           coalesce(
             json_agg(
               json_build_object(
                 'id', asv.id,
                 'serviceId', asv.service_id,
                 'serviceName', s.name,
                 'staffProfileId', asv.staff_profile_id,
                 'sortOrder', asv.sort_order,
                 'startsAt', asv.starts_at,
                 'endsAt', asv.ends_at,
                 'priceMinor', asv.price_minor
               ) order by asv.sort_order
             ) filter (where asv.id is not null),
             '[]'::json
           ) as services
      from appointments a
      join customers c on c.id = a.customer_id
      left join appointment_services asv on asv.appointment_id = a.id
      left join services s on s.id = asv.service_id
     where a.deleted_at is null
       and a.starts_at >= ${filters.from.toISOString()}::timestamptz
       and a.starts_at <  ${filters.to.toISOString()}::timestamptz
       and (${filters.branchId ?? null}::uuid is null or a.branch_id = ${filters.branchId ?? null}::uuid)
       and (${filters.customerId ?? null}::uuid is null
            or a.customer_id = ${filters.customerId ?? null}::uuid)
       and (${statuses}::text is null
            or a.status::text = any(string_to_array(${statuses}, ',')))
       and (${filters.staffProfileId ?? null}::uuid is null or exists (
             select 1 from appointment_services f
              where f.appointment_id = a.id
                and f.staff_profile_id = ${filters.staffProfileId ?? null}::uuid
           ))
       -- Görünürlük kısıtı (practitioner): kendi kalemi olmayan randevu hiç
       -- dönmez. Filtrelemeyi uygulamada yapmak, sayfa boyutunu bozardı.
       and (${filters.restrictToStaffProfileId ?? null}::uuid is null or exists (
             select 1 from appointment_services o
              where o.appointment_id = a.id
                and o.staff_profile_id = ${filters.restrictToStaffProfileId ?? null}::uuid
           ))
       and (
         ${filters.cursorStartsAt ?? null}::timestamptz is null
         or (a.starts_at, a.id) >
            (${filters.cursorStartsAt ?? null}::timestamptz, ${filters.cursorId ?? null}::uuid)
       )
     group by a.id, c.full_name, c.phone
     order by a.starts_at, a.id
     limit ${filters.limit}
  `);

  return result.rows;
}

export interface DensityRow extends Record<string, unknown> {
  local_day: string;
  local_hour: number;
  appointment_count: number;
}

/**
 * Yoğunluk ısı haritası verisi: yerel gün × saat başına randevu sayısı.
 *
 * Gruplama ŞUBE saat diliminde yapılır; UTC'ye göre gruplamak, +03:00'lık bir
 * klinikte günü üç saat kaydırıp sabahın ilk randevularını bir önceki güne
 * yazardı.
 */
export async function loadDensity(
  tx: Tx,
  filters: { branchId: string; from: Date; to: Date; restrictToStaffProfileId?: string | undefined },
): Promise<DensityRow[]> {
  const result = await tx.execute<DensityRow>(sql`
    with b as (select id, timezone from branches where id = ${filters.branchId})
    select to_char((a.starts_at at time zone b.timezone)::date, 'YYYY-MM-DD') as local_day,
           extract(hour from (a.starts_at at time zone b.timezone))::int      as local_hour,
           count(*)::int                                                       as appointment_count
      from appointments a
      join b on true
     where a.deleted_at is null
       and a.branch_id = ${filters.branchId}
       and a.status not in ('cancelled', 'no_show')
       and a.starts_at >= ${filters.from.toISOString()}::timestamptz
       and a.starts_at <  ${filters.to.toISOString()}::timestamptz
       and (${filters.restrictToStaffProfileId ?? null}::uuid is null or exists (
             select 1 from appointment_services o
              where o.appointment_id = a.id
                and o.staff_profile_id = ${filters.restrictToStaffProfileId ?? null}::uuid
           ))
     group by 1, 2
     order by 1, 2
  `);

  return result.rows;
}
