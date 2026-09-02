import { sql } from 'drizzle-orm';
import type { RequestContext } from '../../src/common/request-context';
import type { Database } from '../../src/database/database.constants';
import { withTenantTx } from '../../src/database/tenant-tx';

/**
 * Faz 3.1 şema testleri için ham yazım yardımcıları.
 *
 * Bu batch'te HENÜZ ENDPOINT YOK; sınanan şey veritabanının kendisi. Bu yüzden
 * kayıtlar `klinara_app` rolüyle, gerçek kiracı context'i altında ve doğrudan
 * SQL ile yazılır — trigger'lar, RLS ve `EXCLUDE` constraint'i tam olarak
 * üretimdeki gibi devrede olur.
 */

export function tenantCtx(tenantId: string, userId: string | null = null): RequestContext {
  return {
    tenantId,
    userId,
    branchId: null,
    sessionId: null,
    requestId: 'test',
    isPlatformAdmin: false,
    isPublicBooking: false,
  };
}

export interface AppointmentInput {
  branchId: string;
  customerId: string;
  serviceId: string;
  staffProfileId: string;
  startsAt: Date;
  endsAt: Date;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  priceMinor?: number;
  /** Müşteri çakışması kuralı açık kiracılarda yazılır. */
  withCustomerBooking?: boolean;
}

/**
 * Randevuyu kalemi ve kaynak işgaliyle birlikte TEK transaction'da yazar.
 *
 * Üretimde de akış budur: randevu ve `resource_bookings` satırı aynı
 * transaction'da doğar. "Önce müsait mi diye bak, sonra yaz" YAPILMAZ —
 * doğrudan yazılır, çakışma varsa PostgreSQL `23P01` fırlatır.
 */
export async function createAppointment(
  db: Database,
  ctx: RequestContext,
  input: AppointmentInput,
): Promise<string> {
  const bufferBefore = input.bufferBeforeMinutes ?? 0;
  const bufferAfter = input.bufferAfterMinutes ?? 0;
  const durationMinutes = Math.round(
    (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000,
  );

  return withTenantTx(db, ctx, async (tx) => {
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into appointments (tenant_id, branch_id, customer_id, starts_at, ends_at, created_by)
      values (${ctx.tenantId}, ${input.branchId}, ${input.customerId},
              ${input.startsAt.toISOString()}, ${input.endsAt.toISOString()}, ${ctx.userId})
      returning id
    `);
    const appointmentId = inserted.rows[0]?.id;
    if (appointmentId === undefined) throw new Error('Randevu yazılamadı');

    await tx.execute(sql`
      insert into appointment_services (
        tenant_id, appointment_id, service_id, staff_profile_id, sort_order,
        starts_at, ends_at, duration_minutes,
        buffer_before_minutes, buffer_after_minutes, price_minor
      ) values (
        ${ctx.tenantId}, ${appointmentId}, ${input.serviceId}, ${input.staffProfileId}, 0,
        ${input.startsAt.toISOString()}, ${input.endsAt.toISOString()}, ${durationMinutes},
        ${bufferBefore}, ${bufferAfter}, ${input.priceMinor ?? 150000}
      )
    `);

    await tx.execute(sql`
      insert into resource_bookings (
        tenant_id, branch_id, resource_type, resource_id, source_type, appointment_id, time_range
      ) values (
        ${ctx.tenantId}, ${input.branchId}, 'staff', ${input.staffProfileId},
        'appointment', ${appointmentId},
        tstzrange(
          ${input.startsAt.toISOString()}::timestamptz - make_interval(mins => ${bufferBefore}),
          ${input.endsAt.toISOString()}::timestamptz   + make_interval(mins => ${bufferAfter}),
          '[)'
        )
      )
    `);

    if (input.withCustomerBooking === true) {
      await tx.execute(sql`
        insert into customer_bookings (tenant_id, customer_id, appointment_id, time_range)
        values (
          ${ctx.tenantId}, ${input.customerId}, ${appointmentId},
          tstzrange(${input.startsAt.toISOString()}, ${input.endsAt.toISOString()}, '[)')
        )
      `);
    }

    return appointmentId;
  });
}

/** Durum geçişi — trigger'ın izinli geçiş tablosunu uyguladığı yol. */
export async function setStatus(
  db: Database,
  ctx: RequestContext,
  appointmentId: string,
  status: string,
): Promise<void> {
  await withTenantTx(db, ctx, async (tx) => {
    await tx.execute(sql`
      update appointments
         set status = ${status}::appointment_status,
             cancelled_at = case when ${status} = 'cancelled' then now() else cancelled_at end
       where id = ${appointmentId}
    `);
  });
}

export async function readAppointment(
  db: Database,
  ctx: RequestContext,
  appointmentId: string,
): Promise<{ status: string; version: number } | undefined> {
  return withTenantTx(db, ctx, async (tx) => {
    const res = await tx.execute<{ status: string; version: number }>(sql`
      select status, version from appointments where id = ${appointmentId}
    `);
    return res.rows[0];
  });
}

export async function countActiveBookings(
  db: Database,
  ctx: RequestContext,
  appointmentId: string,
): Promise<number> {
  return withTenantTx(db, ctx, async (tx) => {
    const res = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count
        from resource_bookings
       where appointment_id = ${appointmentId} and active
    `);
    return Number(res.rows[0]?.count ?? 0);
  });
}

/** İç içe geçmiş hata zincirinde PostgreSQL kodunu bulur (Drizzle sarmalar). */
export function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== 'object') return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
