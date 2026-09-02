import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  appointmentHistory,
  appointments,
  appointmentServices,
  appointmentStatusTransitions,
  customerBookings,
  resourceBookings,
  staffProfiles,
} from '../../database/schema';
import type { AppointmentStatus } from '../../database/schema/appointments';
import type { Tx } from '../../database/tenant-tx';

export type AppointmentRow = typeof appointments.$inferSelect;
export type AppointmentServiceRow = typeof appointmentServices.$inferSelect;
export type AppointmentHistoryRow = typeof appointmentHistory.$inferSelect;

/**
 * Bir hizmetin bu şube ve bu personel için ÇÖZÜMLENMİŞ tanımı.
 *
 * Öncelik sırası uygunluk motoruyla AYNI olmak zorunda: personelin özel
 * değeri → şube override'ı → hizmetin kendisi. Farklı olsalardı motorun
 * gösterdiği slot ile yazılan randevu birbirini tutmazdı.
 */
export interface ResolvedServiceRow extends Record<string, unknown> {
  service_id: string;
  staff_profile_id: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_minor: string | number;
  vat_rate_basis_points: number;
  competent: boolean;
}

export async function resolveServiceDefinitions(
  tx: Tx,
  branchId: string,
  entries: { serviceId: string; staffProfileId: string }[],
): Promise<ResolvedServiceRow[]> {
  const serviceIds = entries.map((entry) => entry.serviceId).join(',');
  const staffIds = entries.map((entry) => entry.staffProfileId).join(',');

  const result = await tx.execute<ResolvedServiceRow>(sql`
    with pairs as (
      select s.service_id, st.staff_profile_id
        from unnest(string_to_array(${serviceIds}, ',')::uuid[])
             with ordinality as s(service_id, ord)
        join unnest(string_to_array(${staffIds}, ',')::uuid[])
             with ordinality as st(staff_profile_id, ord) on st.ord = s.ord
    )
    select distinct on (p.service_id, p.staff_profile_id)
           p.service_id::text,
           p.staff_profile_id::text,
           coalesce(ss.custom_duration_minutes, bso.duration_minutes, s.duration_minutes)
             as duration_minutes,
           coalesce(bso.buffer_before_minutes, s.buffer_before_minutes) as buffer_before_minutes,
           coalesce(bso.buffer_after_minutes,  s.buffer_after_minutes)  as buffer_after_minutes,
           coalesce(ss.custom_price_minor, bso.price_minor, s.price_minor) as price_minor,
           coalesce(bso.vat_rate_basis_points, s.vat_rate_basis_points) as vat_rate_basis_points,
           (ss.id is not null) as competent
      from pairs p
      join services s on s.id = p.service_id and s.is_active and s.deleted_at is null
      left join staff_services ss
        on ss.staff_profile_id = p.staff_profile_id
       and ss.service_id = p.service_id
       and ss.is_active
       and ss.deleted_at is null
       and (ss.branch_id is null or ss.branch_id = ${branchId})
      left join branch_service_overrides bso
        on bso.service_id = s.id
       and bso.branch_id = ${branchId}
       and bso.deleted_at is null
       and coalesce(bso.is_active, true)
     order by p.service_id, p.staff_profile_id, ss.branch_id nulls last
  `);

  return result.rows;
}

export interface ScheduleCheck extends Record<string, unknown> {
  branch_ok: boolean;
  staff_ok: boolean;
  exception_free: boolean;
}

/**
 * Randevunun çalışma takvimine uyup uymadığı.
 *
 * Bu kontrol uygunluk motorunu TEKRAR ETMEZ, onun kurallarını tek bir aralık
 * için uygular: motor "hangi slotlar açık" sorusunu, bu ise "bu aralık açık
 * mı" sorusunu cevaplar. Çakışma kontrolü burada YOK — onun tek sahibi
 * veritabanındaki EXCLUDE constraint'idir.
 */
export async function checkSchedule(
  tx: Tx,
  input: {
    branchId: string;
    staffProfileId: string;
    visibleStart: Date;
    visibleEnd: Date;
    occupiedStart: Date;
    occupiedEnd: Date;
  },
): Promise<ScheduleCheck | undefined> {
  const result = await tx.execute<ScheduleCheck>(sql`
    with b as (
      select id, timezone from branches where id = ${input.branchId}
    ),
    local as (
      select (${input.visibleStart.toISOString()}::timestamptz at time zone b.timezone) as ls,
             (${input.visibleEnd.toISOString()}::timestamptz   at time zone b.timezone) as le,
             b.timezone
        from b
    ),
    hol as (
      select h.is_closed, h.open_time, h.close_time
        from local, holidays h
       where h.holiday_date = local.ls::date
         and h.deleted_at is null
         and (h.branch_id = ${input.branchId} or h.branch_id is null)
       order by h.branch_id nulls last
       limit 1
    )
    select
      exists (
        select 1
          from local, branch_hours bh
          left join hol on true
         where bh.branch_id = ${input.branchId}
           and bh.day_of_week = extract(dow from local.ls)::int
           and bh.deleted_at is null
           and not coalesce(hol.is_closed, bh.is_closed)
           and local.ls::time >= coalesce(hol.open_time, bh.open_time)
           and local.le::time <= coalesce(hol.close_time, bh.close_time)
           and local.ls::date = (local.le - interval '1 microsecond')::date
           and (
             hol.open_time is not null
             or bh.break_start_time is null
             or not (local.ls::time < bh.break_end_time and local.le::time > bh.break_start_time)
           )
      ) as branch_ok,
      exists (
        select 1
          from local, staff_schedules sch
         where sch.staff_profile_id = ${input.staffProfileId}
           and sch.branch_id = ${input.branchId}
           and sch.day_of_week = extract(dow from local.ls)::int
           and sch.deleted_at is null
           and not sch.is_off
           and local.ls::time >= sch.start_time
           and local.le::time <= sch.end_time
      ) as staff_ok,
      not exists (
        select 1
          from schedule_exceptions e
         where e.staff_profile_id = ${input.staffProfileId}
           and e.branch_id = ${input.branchId}
           and e.is_active
           and e.deleted_at is null
           and e.recurrence_type = 'none'
           and tstzrange(e.starts_at, e.ends_at, '[)')
               && tstzrange(${input.occupiedStart.toISOString()}::timestamptz,
                            ${input.occupiedEnd.toISOString()}::timestamptz, '[)')
        union all
        -- Haftalık tekrar: yalnız hedef günün ÇEVRESİ açılır; tüm seriyi
        -- üretmek gereksiz, aralık zaten tek bir güne düşüyor.
        select 1
          from schedule_exceptions e
          join b on true
          cross join lateral (
            select ((d::date + (e.starts_at at time zone b.timezone)::time) at time zone b.timezone)
                     as starts_at
              from generate_series(
                     date_trunc('day', ${input.occupiedStart.toISOString()}::timestamptz
                                       at time zone b.timezone) - interval '1 day',
                     date_trunc('day', ${input.occupiedEnd.toISOString()}::timestamptz
                                       at time zone b.timezone) + interval '1 day',
                     interval '1 day'
                   ) d
             where extract(dow from d)::int = any(e.recurrence_weekdays)
               and d <= (e.recurrence_until at time zone b.timezone)
               and d >= date_trunc('day', e.starts_at at time zone b.timezone)
               and (
                 floor(extract(epoch from (
                   date_trunc('week', d) - date_trunc('week', e.starts_at at time zone b.timezone)
                 )) / 604800)::int % e.recurrence_interval_weeks
               ) = 0
          ) occ
         where e.staff_profile_id = ${input.staffProfileId}
           and e.branch_id = ${input.branchId}
           and e.is_active
           and e.deleted_at is null
           and e.recurrence_type = 'weekly'
           and tstzrange(occ.starts_at, occ.starts_at + (e.ends_at - e.starts_at), '[)')
               && tstzrange(${input.occupiedStart.toISOString()}::timestamptz,
                            ${input.occupiedEnd.toISOString()}::timestamptz, '[)')
      ) as exception_free
  `);

  return result.rows[0];
}

export interface ConflictRow extends Record<string, unknown> {
  resource_id: string;
  appointment_id: string | null;
  from_at: Date;
  to_at: Date;
}

/** Çakışan AKTİF işgaller — 409 gövdesine hangi kaynağın dolu olduğunu yazmak için. */
export async function findConflicts(
  tx: Tx,
  spans: { staffProfileId: string; from: Date; to: Date }[],
): Promise<ConflictRow[]> {
  if (spans.length === 0) return [];

  const staffIds = spans.map((span) => span.staffProfileId).join(',');
  const froms = spans.map((span) => span.from.toISOString()).join(',');
  const tos = spans.map((span) => span.to.toISOString()).join(',');

  const result = await tx.execute<ConflictRow>(sql`
    with wanted as (
      select s.staff_profile_id,
             tstzrange(f.from_at::timestamptz, t.to_at::timestamptz, '[)') as span
        from unnest(string_to_array(${staffIds}, ',')::uuid[]) with ordinality as s(staff_profile_id, ord)
        join unnest(string_to_array(${froms}, ',')) with ordinality as f(from_at, ord) on f.ord = s.ord
        join unnest(string_to_array(${tos}, ','))   with ordinality as t(to_at, ord)   on t.ord = s.ord
    )
    select distinct
           rb.resource_id::text,
           rb.appointment_id::text,
           lower(rb.time_range) as from_at,
           upper(rb.time_range) as to_at
      from wanted w
      join resource_bookings rb
        on rb.resource_id = w.staff_profile_id
       and rb.active
       and rb.time_range && w.span
     order by from_at
  `);

  return result.rows;
}

export async function insertAppointment(
  tx: Tx,
  values: {
    tenantId: string;
    branchId: string;
    customerId: string;
    startsAt: Date;
    endsAt: Date;
    notes?: string | undefined;
    createdBy: string | null;
    /**
     * Randevunun kaynağı. Enum 0018'den beri var ama `'online'` Faz 9'a kadar
     * hiç yazılmamıştı: raporlarda "online randevu oranı" sorusunun cevabı
     * burada doğuyor.
     */
    origin?: 'internal' | 'online';
  },
): Promise<AppointmentRow> {
  const [row] = await tx.insert(appointments).values(values).returning();
  if (row === undefined) throw new Error('Randevu oluşturulamadı');
  return row;
}

export async function insertAppointmentServices(
  tx: Tx,
  rows: (typeof appointmentServices.$inferInsert)[],
): Promise<AppointmentServiceRow[]> {
  if (rows.length === 0) return [];
  return tx.insert(appointmentServices).values(rows).returning();
}

export async function deleteAppointmentServices(tx: Tx, appointmentId: string): Promise<void> {
  await tx.delete(appointmentServices).where(eq(appointmentServices.appointmentId, appointmentId));
}

/**
 * Kaynak işgalini yazar.
 *
 * `[)` sınırı ve buffer'ın dahil edilmesi TEK yerde, burada kurulur: sınır
 * kuralının iki farklı yerde ayrı ayrı yazılması, birinin bir gün diğerinden
 * ayrılması demektir.
 *
 * Tutma (`source_type='hold'`) için kardeş fonksiyon `insertHoldBooking`;
 * ikisi de AYNI `resource_bookings_no_overlap` EXCLUDE constraint'ine yazar,
 * çakışma garantisi bu yüzden ortak.
 */
export async function insertResourceBooking(
  tx: Tx,
  values: {
    tenantId: string;
    branchId: string;
    staffProfileId: string;
    appointmentId: string;
    from: Date;
    to: Date;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into resource_bookings (
      tenant_id, branch_id, resource_type, resource_id, source_type, appointment_id, time_range
    ) values (
      ${values.tenantId}, ${values.branchId}, 'staff', ${values.staffProfileId},
      'appointment', ${values.appointmentId},
      tstzrange(${values.from.toISOString()}::timestamptz, ${values.to.toISOString()}::timestamptz, '[)')
    )
  `);
}

export async function insertCustomerBooking(
  tx: Tx,
  values: {
    tenantId: string;
    customerId: string;
    appointmentId: string;
    from: Date;
    to: Date;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into customer_bookings (tenant_id, customer_id, appointment_id, time_range)
    values (
      ${values.tenantId}, ${values.customerId}, ${values.appointmentId},
      tstzrange(${values.from.toISOString()}::timestamptz, ${values.to.toISOString()}::timestamptz, '[)')
    )
  `);
}

/** Aktif işgalleri kapatır (erteleme ve iptalde). Satır SİLİNMEZ. */
export async function deactivateBookings(tx: Tx, appointmentId: string): Promise<void> {
  await tx
    .update(resourceBookings)
    .set({ active: false })
    .where(and(eq(resourceBookings.appointmentId, appointmentId), eq(resourceBookings.active, true)));
  await tx
    .update(customerBookings)
    .set({ active: false })
    .where(and(eq(customerBookings.appointmentId, appointmentId), eq(customerBookings.active, true)));
}

export async function findAppointmentById(
  tx: Tx,
  id: string,
): Promise<AppointmentRow | undefined> {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
    .limit(1);
  return row;
}

export async function listAppointmentServices(
  tx: Tx,
  appointmentId: string,
): Promise<AppointmentServiceRow[]> {
  return tx
    .select()
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appointmentId))
    .orderBy(appointmentServices.sortOrder);
}

/**
 * Sürüm kilidiyle güncelleme.
 *
 * `where version = $expected` atomiktir: iki eş zamanlı istekten yalnız biri
 * satırı bulur, diğeri 0 satır günceller ve `undefined` alır. Ayrı bir "önce
 * oku, sonra karşılaştır" adımı yarış bırakırdı.
 */
export async function updateWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  values: Partial<{
    notes: string | null;
    startsAt: Date;
    endsAt: Date;
    status: AppointmentStatus;
    cancellationReason: string | null;
    cancelledBy: string | null;
    cancelledAt: Date | null;
  }>,
): Promise<AppointmentRow | undefined> {
  const [row] = await tx
    .update(appointments)
    .set(values)
    .where(
      and(
        eq(appointments.id, id),
        eq(appointments.version, expectedVersion),
        isNull(appointments.deletedAt),
      ),
    )
    .returning();
  return row;
}

export async function findAllowedTransition(
  tx: Tx,
  from: AppointmentStatus,
  to: AppointmentStatus,
): Promise<{ requiredPermission: string | null } | undefined> {
  const [row] = await tx
    .select({ requiredPermission: appointmentStatusTransitions.requiredPermission })
    .from(appointmentStatusTransitions)
    .where(
      and(
        eq(appointmentStatusTransitions.fromStatus, from),
        eq(appointmentStatusTransitions.toStatus, to),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Kullanıcının personel profili — `appointment:read.own` kısıtı için.
 *
 * Randevu personele (staff_profile) bağlıdır, kullanıcıya değil; "kendi
 * randevum" sorusunun cevabı bu eşlemeden geçer.
 */
export async function findStaffProfileIdByUser(
  tx: Tx,
  userId: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: staffProfiles.id })
    .from(staffProfiles)
    .where(and(eq(staffProfiles.userId, userId), isNull(staffProfiles.deletedAt)))
    .limit(1);
  return row?.id;
}

export async function insertHistory(
  tx: Tx,
  values: typeof appointmentHistory.$inferInsert,
): Promise<void> {
  await tx.insert(appointmentHistory).values(values);
}

export async function listHistory(
  tx: Tx,
  appointmentId: string,
): Promise<AppointmentHistoryRow[]> {
  return tx
    .select()
    .from(appointmentHistory)
    .where(eq(appointmentHistory.appointmentId, appointmentId))
    .orderBy(desc(appointmentHistory.createdAt));
}

/**
 * Slot tutmayı kaynak işgali olarak yazar (Batch 9.4).
 *
 * `insertResourceBooking` ile aynı tabloya, aynı `[)` sınırıyla ve aynı
 * EXCLUDE constraint'ine yazıyor — tutmanın randevuyla aynı garantiyi alması
 * bunun doğal sonucu. Ayrı bir "tutma çakışması" kontrolü YOK; uygulama
 * seviyesinde bir kilit, iki eş zamanlı isteğin ikisini de geçirebilecek bir
 * kilit olurdu.
 */
export async function insertHoldBooking(
  tx: Tx,
  values: {
    tenantId: string;
    branchId: string;
    staffProfileId: string;
    holdId: string;
    from: Date;
    to: Date;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into resource_bookings (
      tenant_id, branch_id, resource_type, resource_id, source_type, hold_id, time_range
    ) values (
      ${values.tenantId}, ${values.branchId}, 'staff', ${values.staffProfileId},
      'hold', ${values.holdId},
      tstzrange(${values.from.toISOString()}::timestamptz, ${values.to.toISOString()}::timestamptz, '[)')
    )
  `);
}

/** Tutmanın işgalini serbest bırakır. Satır SİLİNMEZ, `active=false` olur. */
export async function deactivateHoldBooking(tx: Tx, holdId: string): Promise<void> {
  await tx.execute(sql`
    update resource_bookings set active = false, updated_at = now()
     where hold_id = ${holdId} and active
  `);
}
