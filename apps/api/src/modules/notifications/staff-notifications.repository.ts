import { and, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
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

/**
 * Bildirimi kimin göreceği — zil akışı ve push alıcıları AYNI kuralı izler
 * (`push_recipients`, 0060).
 *
 * - Şube: kiracı geneli olmayan kullanıcı yalnız kendi şubelerinin (ya da
 *   şubesiz) bildirimlerini görür.
 * - Gelen mesaj / iletilemedi: mesajlaşma işi; `notification:send` gerekir.
 * - Randevu olayları: `appointment:read.all` yoksa yalnız kullanıcının KENDİ
 *   kalemi olan randevular.
 */
export interface NotificationViewer {
  userId: string;
  tenantWide: boolean;
  branchIds: readonly string[];
  canMessage: boolean;
  readsAllAppointments: boolean;
}

function visibleTo(viewer: NotificationViewer): SQL {
  const branch = viewer.tenantWide
    ? sql`true`
    : viewer.branchIds.length === 0
      ? sql`${staffNotifications.branchId} is null`
      : sql`(${staffNotifications.branchId} is null or ${staffNotifications.branchId} in (${sql.join(
          viewer.branchIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}))`;
  const messaging = viewer.canMessage
    ? sql`true`
    : sql`${staffNotifications.kind} not in ('inbound_message', 'delivery_failed')`;
  const own = viewer.readsAllAppointments
    ? sql`true`
    : sql`(${staffNotifications.appointmentId} is null or exists (
        select 1 from appointment_services s
          join staff_profiles sp on sp.id = s.staff_profile_id
         where s.appointment_id = ${staffNotifications.appointmentId}
           and sp.user_id = ${viewer.userId}::uuid
      ))`;
  return sql`(${branch} and ${messaging} and ${own})`;
}

/** Kullanıcının akışı: bildirimler + O KULLANICININ okundu bilgisi. */
export async function list(
  tx: Tx,
  input: { viewer: NotificationViewer; limit: number; before?: Date },
): Promise<StaffNotificationRow[]> {
  const userId = input.viewer.userId;
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
        eq(staffNotificationReads.userId, userId),
      ),
    )
    .where(
      and(
        visibleTo(input.viewer),
        input.before === undefined ? undefined : lt(staffNotifications.createdAt, input.before),
      ),
    )
    .orderBy(desc(staffNotifications.createdAt), desc(staffNotifications.id))
    .limit(input.limit);
}

export async function unreadCount(tx: Tx, viewer: NotificationViewer): Promise<number> {
  const userId = viewer.userId;
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
    .where(and(visibleTo(viewer), isNull(staffNotificationReads.readAt)));
  return row?.count ?? 0;
}

/** Okundu işareti; `ids` boşsa okunmamışların TAMAMI işaretlenir. */
export async function markRead(
  tx: Tx,
  input: { tenantId: string; viewer: NotificationViewer; ids?: string[] },
): Promise<void> {
  const ids = input.ids ?? [];
  const userId = input.viewer.userId;
  // Aynı bildirimi iki sekmeden işaretlemek hata değil, aynı sonucu isteyen
  // bir tekrar: ilk okundu zamanı korunur.
  await tx.execute(sql`
    insert into staff_notification_reads (notification_id, user_id, tenant_id)
    select ${staffNotifications.id}, ${userId}::uuid, ${input.tenantId}::uuid
    from ${staffNotifications}
    where ${visibleTo(input.viewer)} and ${
      ids.length === 0
        ? sql`true`
        : sql`${staffNotifications.id} in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
    }
    on conflict (notification_id, user_id) do nothing
  `);
}

/** Push işi için: yalnız yönlendirme alanları — başlık/gövde (kişisel veri) okunmaz. */
export async function findForPush(
  tx: Tx,
  id: string,
): Promise<
  | {
      kind: StaffNotificationKind;
      branchId: string | null;
      appointmentId: string | null;
      conversationId: string | null;
    }
  | undefined
> {
  const [row] = await tx
    .select({
      kind: staffNotifications.kind,
      branchId: staffNotifications.branchId,
      appointmentId: staffNotifications.appointmentId,
      conversationId: staffNotifications.conversationId,
    })
    .from(staffNotifications)
    .where(eq(staffNotifications.id, id))
    .limit(1);
  return row;
}
