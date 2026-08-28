import { and, eq, sql } from 'drizzle-orm';
import {
  branchNotificationSettings,
  scheduledNotifications,
  type NotificationEvent,
  type ScheduledNotificationStatus,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type ScheduledNotificationRow = typeof scheduledNotifications.$inferSelect;
export type BranchReminderSettingsRow = typeof branchNotificationSettings.$inferSelect;

/** Hatırlatma planı için gereken randevu özeti. */
export interface AppointmentSummary {
  id: string;
  branchId: string;
  customerId: string;
  status: string;
  startsAt: Date;
  customerName: string;
  branchName: string;
  branchTimezone: string;
  serviceNames: string[];
}

export async function findAppointmentSummary(
  tx: Tx,
  appointmentId: string,
): Promise<AppointmentSummary | undefined> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select a.id, a.branch_id, a.customer_id, a.status::text as status, a.starts_at,
           c.full_name as customer_name,
           b.name as branch_name, b.timezone as branch_timezone,
           coalesce(
             (select array_agg(s.name order by asv.sort_order)
                from appointment_services asv
                join services s on s.id = asv.service_id
               where asv.appointment_id = a.id),
             '{}'
           ) as service_names
      from appointments a
      join customers c on c.id = a.customer_id
      join branches  b on b.id = a.branch_id
     where a.id = ${appointmentId}
     limit 1
  `);

  const row = result.rows[0];
  if (row === undefined) return undefined;

  const rawNames = row['service_names'];
  return {
    id: row['id'] as string,
    branchId: row['branch_id'] as string,
    customerId: row['customer_id'] as string,
    status: row['status'] as string,
    startsAt: new Date(row['starts_at'] as string),
    customerName: row['customer_name'] as string,
    branchName: row['branch_name'] as string,
    branchTimezone: row['branch_timezone'] as string,
    serviceNames: Array.isArray(rawNames) ? (rawNames as string[]) : [],
  };
}

/**
 * Geçerli hatırlatma saatleri: ÖNCE şube ayarı, boşsa kiracı ayarı.
 *
 * Aynı varsayılanı iki tabloda tutmak yerine şube satırı BOŞ bırakılabiliyor;
 * iki yerde saklanan aynı değer er ya da geç birbirinden ayrılırdı.
 */
export async function resolveReminderHours(tx: Tx, branchId: string): Promise<number[]> {
  const result = await tx.execute<{ hours: number[] | string }>(sql`
    select coalesce(
             nullif(bns.reminder_hours_before, '{}'),
             ts.reminder_hours_before
           ) as hours
      from tenant_settings ts
      left join branch_notification_settings bns on bns.branch_id = ${branchId}::uuid
     limit 1
  `);

  const raw = result.rows[0]?.hours;
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string') {
    return raw
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((part) => part.length > 0)
      .map(Number);
  }
  return [];
}

export async function findBranchSettings(
  tx: Tx,
  branchId: string,
): Promise<BranchReminderSettingsRow | undefined> {
  const [row] = await tx
    .select()
    .from(branchNotificationSettings)
    .where(eq(branchNotificationSettings.branchId, branchId))
    .limit(1);
  return row;
}

export async function upsertBranchSettings(
  tx: Tx,
  tenantId: string,
  branchId: string,
  values: {
    reminderHoursBefore: number[];
    noShowFollowupEnabled: boolean;
    noShowFollowupDelayHours: number;
  },
): Promise<BranchReminderSettingsRow> {
  const [row] = await tx
    .insert(branchNotificationSettings)
    .values({ tenantId, branchId, ...values })
    .onConflictDoUpdate({
      target: branchNotificationSettings.branchId,
      set: { ...values, updatedAt: sql`now()` },
    })
    .returning();
  return row as BranchReminderSettingsRow;
}

/**
 * Planlanmış hatırlatmayı yazar.
 *
 * `on conflict do nothing`: kısmi tekil indeks aynı randevu + tür + offset
 * için ikinci BEKLEYEN satırı zaten engelliyor. Çift gönderim koruması
 * VERİDEN geliyor, çağıranın dikkatinden değil.
 */
export async function insertScheduled(
  tx: Tx,
  values: {
    tenantId: string;
    branchId: string;
    appointmentId: string;
    event: NotificationEvent;
    offsetHours: number;
    scheduledFor: Date;
  },
): Promise<ScheduledNotificationRow | undefined> {
  const [row] = await tx
    .insert(scheduledNotifications)
    .values(values)
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function findScheduledById(
  tx: Tx,
  id: string,
): Promise<ScheduledNotificationRow | undefined> {
  const [row] = await tx
    .select()
    .from(scheduledNotifications)
    .where(eq(scheduledNotifications.id, id))
    .limit(1);
  return row;
}

export async function listScheduledForAppointment(
  tx: Tx,
  appointmentId: string,
): Promise<ScheduledNotificationRow[]> {
  return tx
    .select()
    .from(scheduledNotifications)
    .where(eq(scheduledNotifications.appointmentId, appointmentId))
    .orderBy(scheduledNotifications.scheduledFor);
}

export async function markScheduled(
  tx: Tx,
  id: string,
  status: ScheduledNotificationStatus,
  messageLogId?: string | null,
): Promise<void> {
  await tx
    .update(scheduledNotifications)
    .set({ status, messageLogId: messageLogId ?? null })
    .where(eq(scheduledNotifications.id, id));
}

/** Bekleyen satırları toplu kapatır (iptal ya da erteleme). */
export async function closePending(
  tx: Tx,
  appointmentId: string,
  status: Extract<ScheduledNotificationStatus, 'cancelled' | 'superseded'>,
): Promise<number> {
  const result = await tx
    .update(scheduledNotifications)
    .set({ status })
    .where(
      and(
        eq(scheduledNotifications.appointmentId, appointmentId),
        eq(scheduledNotifications.status, 'pending'),
      ),
    )
    .returning({ id: scheduledNotifications.id });
  return result.length;
}
