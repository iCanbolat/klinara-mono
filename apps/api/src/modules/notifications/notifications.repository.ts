import { and, eq, sql } from 'drizzle-orm';
import {
  customers,
  messageLog,
  notificationTemplates,
  users,
  type MessageStatus,
  type NotificationChannel,
  type NotificationEvent,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type NotificationTemplateRow = typeof notificationTemplates.$inferSelect;
export type MessageLogRow = typeof messageLog.$inferSelect;

/** Gönderim için gereken asgari alıcı bilgisi. */
export interface RecipientContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Şablonlar
// ---------------------------------------------------------------------------

export async function listTemplates(tx: Tx): Promise<NotificationTemplateRow[]> {
  return tx
    .select()
    .from(notificationTemplates)
    .orderBy(notificationTemplates.event, notificationTemplates.channel);
}

export async function findTemplate(
  tx: Tx,
  key: { event: NotificationEvent; channel: NotificationChannel; locale: string },
): Promise<NotificationTemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.event, key.event),
        eq(notificationTemplates.channel, key.channel),
        eq(notificationTemplates.locale, key.locale),
      ),
    )
    .limit(1);
  return row;
}

export async function findTemplateById(
  tx: Tx,
  id: string,
): Promise<NotificationTemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(notificationTemplates)
    .where(eq(notificationTemplates.id, id))
    .limit(1);
  return row;
}

export async function upsertTemplate(
  tx: Tx,
  tenantId: string,
  values: {
    event: NotificationEvent;
    channel: NotificationChannel;
    locale: string;
    subject: string | null;
    body: string;
    whatsappTemplateName: string | null;
    whatsappTemplateLanguage: string | null;
    whatsappVariables: string[];
    isActive: boolean;
  },
): Promise<NotificationTemplateRow> {
  const [row] = await tx
    .insert(notificationTemplates)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({
      target: [
        notificationTemplates.tenantId,
        notificationTemplates.event,
        notificationTemplates.channel,
        notificationTemplates.locale,
      ],
      set: {
        subject: values.subject,
        body: values.body,
        whatsappTemplateName: values.whatsappTemplateName,
        whatsappTemplateLanguage: values.whatsappTemplateLanguage,
        whatsappVariables: values.whatsappVariables,
        isActive: values.isActive,
        version: sql`${notificationTemplates.version} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row as NotificationTemplateRow;
}

// ---------------------------------------------------------------------------
// Mesaj kaydı
// ---------------------------------------------------------------------------

export async function insertMessage(
  tx: Tx,
  values: typeof messageLog.$inferInsert,
): Promise<MessageLogRow> {
  const [row] = await tx.insert(messageLog).values(values).returning();
  return row as MessageLogRow;
}

export async function findMessageById(tx: Tx, id: string): Promise<MessageLogRow | undefined> {
  const [row] = await tx.select().from(messageLog).where(eq(messageLog.id, id)).limit(1);
  return row;
}

export async function updateMessage(
  tx: Tx,
  id: string,
  values: Partial<typeof messageLog.$inferInsert>,
): Promise<MessageLogRow | undefined> {
  const [row] = await tx.update(messageLog).set(values).where(eq(messageLog.id, id)).returning();
  return row;
}

export interface MessageFilters {
  limit: number;
  cursorCreatedAt?: string | undefined;
  cursorId?: string | undefined;
  customerId?: string | undefined;
  channel?: NotificationChannel | undefined;
  event?: NotificationEvent | undefined;
  status?: MessageStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export const listMessagesOrderKey = (row: MessageLogRow): { sortKey: string; id: string } => ({
  sortKey: row.createdAt.toISOString(),
  id: row.id,
});

export async function listMessages(tx: Tx, filters: MessageFilters): Promise<MessageLogRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select *
      from message_log
     where (${filters.customerId ?? null}::uuid is null
            or customer_id = ${filters.customerId ?? null}::uuid)
       and (${filters.channel ?? null}::notification_channel is null
            or channel = ${filters.channel ?? null}::notification_channel)
       and (${filters.event ?? null}::notification_event is null
            or event = ${filters.event ?? null}::notification_event)
       and (${filters.status ?? null}::message_status is null
            or status = ${filters.status ?? null}::message_status)
       and (${filters.from ?? null}::timestamptz is null
            or created_at >= ${filters.from ?? null}::timestamptz)
       and (${filters.to ?? null}::timestamptz is null
            or created_at < ${filters.to ?? null}::timestamptz)
       and (${filters.cursorCreatedAt ?? null}::timestamptz is null
            or (created_at, id)
               < (${filters.cursorCreatedAt ?? null}::timestamptz, ${filters.cursorId ?? null}::uuid))
     order by created_at desc, id desc
     limit ${filters.limit}
  `);
  return result.rows.map(hydrateMessage);
}

/**
 * Ham `execute` sonucunu satır tipine çevirir.
 *
 * Zaman kolonları burada `new Date(...)` ile kurulur: sürücü ham sorguda
 * `timestamptz` değerini METİN olarak veriyor ve doğrudan atamak, satırı
 * kullanan her yerde "toISOString is not a function" demekti (aynı gerekçe
 * `package-definitions.repository.ts`teki `hydrate`de de yazılı).
 */
function hydrateMessage(row: Record<string, unknown>): MessageLogRow {
  const date = (value: unknown): Date | null =>
    value == null ? null : new Date(value as string);

  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    branchId: (row['branch_id'] as string | null) ?? null,
    customerId: (row['customer_id'] as string | null) ?? null,
    userId: (row['user_id'] as string | null) ?? null,
    channel: row['channel'] as MessageLogRow['channel'],
    event: row['event'] as MessageLogRow['event'],
    status: row['status'] as MessageStatus,
    toMasked: row['to_masked'] as string,
    templateId: (row['template_id'] as string | null) ?? null,
    renderedSubject: (row['rendered_subject'] as string | null) ?? null,
    renderedBody: (row['rendered_body'] as string | null) ?? null,
    provider: (row['provider'] as string | null) ?? null,
    providerMessageId: (row['provider_message_id'] as string | null) ?? null,
    errorCode: (row['error_code'] as string | null) ?? null,
    errorDetail: (row['error_detail'] as string | null) ?? null,
    attempt: Number(row['attempt'] ?? 0),
    scheduledFor: date(row['scheduled_for']) as Date,
    sentAt: date(row['sent_at']),
    deliveredAt: date(row['delivered_at']),
    readAt: date(row['read_at']),
    failedAt: date(row['failed_at']),
    dedupeKey: (row['dedupe_key'] as string | null) ?? null,
    templateVariables: (row['template_variables'] as Record<string, string> | null) ?? null,
    conversationId: (row['conversation_id'] as string | null) ?? null,
    appointmentId: (row['appointment_id'] as string | null) ?? null,
    sentByUserId: (row['sent_by_user_id'] as string | null) ?? null,
    createdAt: date(row['created_at']) as Date,
    updatedAt: date(row['updated_at']) as Date,
  };
}

// ---------------------------------------------------------------------------
// Alıcılar ve saat dilimi
// ---------------------------------------------------------------------------

export async function findCustomerContact(
  tx: Tx,
  customerId: string,
): Promise<RecipientContact | undefined> {
  const [row] = await tx
    .select({
      id: customers.id,
      name: customers.fullName,
      phone: customers.phone,
      email: customers.email,
      deletedAt: customers.deletedAt,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (row === undefined || row.deletedAt !== null) return undefined;
  return { id: row.id, name: row.name, phone: row.phone, email: row.email };
}

export async function findUserContact(
  tx: Tx,
  userId: string,
): Promise<RecipientContact | undefined> {
  const [row] = await tx
    .select({
      id: users.id,
      name: users.fullName,
      phone: users.phone,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

/**
 * Kiracının WhatsApp hesabı bağlı VE doğrulanmış mı.
 *
 * Yalnız `active` sayılır: kaydedilip doğrulanmamış (`unconfigured`) ya da
 * doğrulaması başarısız (`error`) bir hesaba gönderim, müşteriye hiçbir şey
 * ulaşmayan bir kayıt üretirdi.
 */
/** 24 saatlik müşteri hizmetleri penceresi açık mı — serbest metin yalnız o zaman gider. */
export async function isWhatsAppWindowOpen(tx: Tx, phone: string): Promise<boolean> {
  const result = await tx.execute<{ open: boolean }>(sql`
    select last_inbound_at > now() - interval '24 hours' as open
    from whatsapp_contact_windows
    where phone = ${phone}
    limit 1
  `);
  return result.rows[0]?.open === true;
}

/** Template'in Meta'daki durumu; yansımada satır yoksa `undefined`. */
export async function whatsAppTemplateStatus(
  tx: Tx,
  name: string,
  language: string,
): Promise<string | undefined> {
  const result = await tx.execute<{ status: string }>(sql`
    select status from whatsapp_templates
    where name = ${name} and language = ${language}
    limit 1
  `);
  return result.rows[0]?.status;
}

export async function isWhatsAppReady(tx: Tx): Promise<boolean> {
  const result = await tx.execute<{ status: string }>(sql`
    select status from whatsapp_accounts limit 1
  `);
  return result.rows[0]?.status === 'active';
}
