import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';
import {
  staffNotificationReads,
  staffNotifications,
  type StaffNotificationKind,
} from '../../database/schema';

export interface StaffNotificationRow {
  id: string;
  kind: StaffNotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface InsertStaffNotification {
  tenantId: string;
  branchId?: string | null;
  kind: StaffNotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  appointmentId?: string | null;
  conversationId?: string | null;
}

export async function insert(tx: Tx, input: InsertStaffNotification): Promise<{ id: string }> {
  const [row] = await tx
    .insert(staffNotifications)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      appointmentId: input.appointmentId ?? null,
      conversationId: input.conversationId ?? null,
    })
    .returning({ id: staffNotifications.id });
  return row as { id: string };
}

/** Kullanıcının akışı: bildirimler + O KULLANICININ okundu bilgisi. */
export async function list(
  tx: Tx,
  input: { userId: string; limit: number; before?: Date },
): Promise<StaffNotificationRow[]> {
  return tx
    .select({
      id: staffNotifications.id,
      kind: staffNotifications.kind,
      title: staffNotifications.title,
      body: staffNotifications.body,
      link: staffNotifications.link,
      createdAt: staffNotifications.createdAt,
      readAt: staffNotificationReads.readAt,
    })
    .from(staffNotifications)
    .leftJoin(
      staffNotificationReads,
      and(
        eq(staffNotificationReads.notificationId, staffNotifications.id),
        eq(staffNotificationReads.userId, input.userId),
      ),
    )
    .where(input.before === undefined ? undefined : lt(staffNotifications.createdAt, input.before))
    .orderBy(desc(staffNotifications.createdAt), desc(staffNotifications.id))
    .limit(input.limit);
}

export async function unreadCount(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(staffNotifications)
    .leftJoin(
      staffNotificationReads,
      and(
        eq(staffNotificationReads.notificationId, staffNotifications.id),
        eq(staffNotificationReads.userId, userId),
      ),
    )
    .where(isNull(staffNotificationReads.readAt));
  return row?.count ?? 0;
}

/** Okundu işareti; `ids` boşsa okunmamışların TAMAMI işaretlenir. */
export async function markRead(
  tx: Tx,
  input: { tenantId: string; userId: string; ids?: string[] },
): Promise<void> {
  const ids = input.ids ?? [];
  // Aynı bildirimi iki sekmeden işaretlemek hata değil, aynı sonucu isteyen
  // bir tekrar: ilk okundu zamanı korunur.
  await tx.execute(sql`
    insert into staff_notification_reads (notification_id, user_id, tenant_id)
    select n.id, ${input.userId}::uuid, ${input.tenantId}::uuid
    from staff_notifications n
    where ${
      ids.length === 0
        ? sql`true`
        : sql`n.id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
    }
    on conflict (notification_id, user_id) do nothing
  `);
}
