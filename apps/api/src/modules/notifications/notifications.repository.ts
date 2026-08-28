import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  branches,
  contactOptOuts,
  customers,
  messageLog,
  notificationPreferences,
  notificationTemplates,
  tenants,
  users,
  type MessageStatus,
  type NotificationChannel,
  type NotificationEvent,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type NotificationTemplateRow = typeof notificationTemplates.$inferSelect;
export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
export type MessageLogRow = typeof messageLog.$inferSelect;
export type ContactOptOutRow = typeof contactOptOuts.$inferSelect;

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
// Tercihler
// ---------------------------------------------------------------------------

export async function listPreferences(tx: Tx): Promise<NotificationPreferenceRow[]> {
  return tx
    .select()
    .from(notificationPreferences)
    .orderBy(notificationPreferences.event, notificationPreferences.branchId);
}

/**
 * Geçerli tercih: ÖNCE şube satırı, yoksa kiracı satırı.
 *
 * İki sorgu yerine tek sorgu + sıralama: `branch_id is not null` önce gelsin
 * diye sıralanıyor, ilk satır kazanan.
 */
export async function findEffectivePreference(
  tx: Tx,
  input: { event: NotificationEvent; branchId: string | null },
): Promise<NotificationPreferenceRow | undefined> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select *
      from notification_preferences
     where event = ${input.event}::notification_event
       and (branch_id is null or branch_id = ${input.branchId}::uuid)
     order by (branch_id is not null) desc
     limit 1
  `);
  const row = result.rows[0];
  return row === undefined ? undefined : hydratePreference(row);
}

export async function upsertPreference(
  tx: Tx,
  tenantId: string,
  values: {
    branchId: string | null;
    event: NotificationEvent;
    channels: NotificationChannel[];
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  },
): Promise<NotificationPreferenceRow> {
  // Kısmi tekil indeksler iki ayrı hedef demek (`branch_id is null` /
  // `is not null`); `onConflictDoUpdate` tek hedef aldığı için üst satır elle
  // aranıp güncelleniyor.
  const existing = await tx.execute<Record<string, unknown>>(sql`
    select id from notification_preferences
     where event = ${values.event}::notification_event
       and branch_id is not distinct from ${values.branchId}::uuid
     limit 1
  `);

  const existingId = existing.rows[0]?.['id'] as string | undefined;
  const channels = sql`${`{${values.channels.join(',')}}`}::notification_channel[]`;

  const result =
    existingId === undefined
      ? await tx.execute<Record<string, unknown>>(sql`
          insert into notification_preferences
            (tenant_id, branch_id, event, channels, quiet_hours_start, quiet_hours_end)
          values (${tenantId}::uuid, ${values.branchId}::uuid,
                  ${values.event}::notification_event, ${channels},
                  ${values.quietHoursStart}::time, ${values.quietHoursEnd}::time)
          returning *
        `)
      : await tx.execute<Record<string, unknown>>(sql`
          update notification_preferences
             set channels = ${channels},
                 quiet_hours_start = ${values.quietHoursStart}::time,
                 quiet_hours_end   = ${values.quietHoursEnd}::time
           where id = ${existingId}::uuid
          returning *
        `);

  return hydratePreference(result.rows[0] as Record<string, unknown>);
}

function hydratePreference(row: Record<string, unknown>): NotificationPreferenceRow {
  // Sürücü `notification_channel[]` sütununu çoğu zaman JS dizisi olarak
  // verir; ham `{sms,email}` metni gelme ihtimaline karşı iki biçim de
  // karşılanıyor (`columns.ts`teki dizi tiplerinin aynı gerekçesi).
  const rawChannels: unknown = row['channels'];
  const channels = Array.isArray(rawChannels)
    ? (rawChannels as NotificationChannel[])
    : (String(typeof rawChannels === 'string' ? rawChannels : '')
        .replace(/^\{|\}$/g, '')
        .split(',')
        .filter((part) => part.length > 0) as NotificationChannel[]);

  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    branchId: (row['branch_id'] as string | null) ?? null,
    event: row['event'] as NotificationEvent,
    channels,
    quietHoursStart: (row['quiet_hours_start'] as string | null) ?? null,
    quietHoursEnd: (row['quiet_hours_end'] as string | null) ?? null,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  };
}

// ---------------------------------------------------------------------------
// Opt-out
// ---------------------------------------------------------------------------

export async function listActiveOptOuts(
  tx: Tx,
  customerId: string,
): Promise<ContactOptOutRow[]> {
  return tx
    .select()
    .from(contactOptOuts)
    .where(and(eq(contactOptOuts.customerId, customerId), isNull(contactOptOuts.revokedAt)));
}

export async function insertOptOut(
  tx: Tx,
  values: typeof contactOptOuts.$inferInsert,
): Promise<ContactOptOutRow> {
  const [row] = await tx.insert(contactOptOuts).values(values).returning();
  return row as ContactOptOutRow;
}

export async function revokeOptOuts(
  tx: Tx,
  input: { customerId: string; channel: NotificationChannel | null; actorUserId: string | null },
): Promise<number> {
  const result = await tx.execute(sql`
    update contact_opt_outs
       set revoked_at = now(),
           revoked_by = ${input.actorUserId}::uuid
     where customer_id = ${input.customerId}::uuid
       and revoked_at is null
       and (${input.channel}::notification_channel is null
            or channel is not distinct from ${input.channel}::notification_channel)
  `);
  return result.rowCount ?? 0;
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
    kind: row['kind'] as MessageLogRow['kind'],
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

/** Şube saat dilimi; şube verilmediyse kiracınınki. */
export async function resolveTimezone(tx: Tx, branchId: string | null): Promise<string> {
  if (branchId !== null) {
    const [row] = await tx
      .select({ timezone: branches.timezone })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    if (row !== undefined) return row.timezone;
  }
  const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).limit(1);
  return tenant?.timezone ?? 'Europe/Istanbul';
}
