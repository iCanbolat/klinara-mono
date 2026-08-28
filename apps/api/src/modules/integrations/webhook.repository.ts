import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  inboundMessages,
  messageActions,
  webhookEvents,
  whatsappAccounts,
  type MessageActionKind,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type InboundMessageRow = typeof inboundMessages.$inferSelect;
export type MessageActionRow = typeof messageActions.$inferSelect;

/** WABA kimliğinden kiracıyı çözer — sistem bağlamında koşar. */
export async function findTenantByWaba(
  tx: Tx,
  wabaId: string,
): Promise<{ tenantId: string; appSecretEncrypted: string | null } | undefined> {
  const result = await tx.execute<{ tenant_id: string; app_secret_encrypted: string | null }>(sql`
    select tenant_id, app_secret_encrypted
      from whatsapp_accounts
     where waba_id = ${wabaId}
     limit 1
  `);
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : { tenantId: row.tenant_id, appSecretEncrypted: row.app_secret_encrypted };
}

/** Tek bir kiracının hesabı (kiracı bağlamında). */
export async function findAccountPhoneNumberIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ phoneNumberId: whatsappAccounts.phoneNumberId })
    .from(whatsappAccounts);
  return rows.map((row) => row.phoneNumberId);
}

/**
 * Olayı kaydeder. Aynı olay ikinci kez gelirse `false` döner ve İŞLENMEZ —
 * idempotency veriden gelir, uygulama koduna güvenilmez.
 */
export async function recordEvent(
  tx: Tx,
  values: { eventId: string; tenantId: string | null; payload: Record<string, unknown> },
): Promise<boolean> {
  const result = await tx.execute(sql`
    insert into webhook_events (provider, event_id, tenant_id, payload)
    values ('whatsapp', ${values.eventId}, ${values.tenantId}::uuid, ${sql.raw(
      `'${JSON.stringify(values.payload).replace(/'/g, "''")}'::jsonb`,
    )})
    on conflict (provider, event_id) do nothing
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function markProcessed(tx: Tx, eventId: string, error?: string): Promise<void> {
  await tx.execute(sql`
    update webhook_events
       set processed_at = now(), error = ${error ?? null}
     where provider = 'whatsapp' and event_id = ${eventId}
  `);
}

/** Teslim durumu güncellemesi — sağlayıcı kimliğinden mesajı bulur. */
export async function applyDeliveryStatus(
  tx: Tx,
  input: { providerMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: Date; errorDetail?: string },
): Promise<boolean> {
  const column =
    input.status === 'delivered'
      ? sql`delivered_at = ${input.at}`
      : input.status === 'read'
        ? sql`read_at = ${input.at}`
        : input.status === 'failed'
          ? sql`failed_at = ${input.at}`
          : sql`sent_at = coalesce(sent_at, ${input.at})`;

  // Durum GERİ GİTMEZ: `read` gelmiş bir mesaja sonradan gelen `delivered`
  // bildirimi (Meta olayları sıralı garanti etmiyor) durumu geriye çekmemeli.
  const result = await tx.execute(sql`
    update message_log
       set status = case
             when status = 'read' then status
             when status = 'delivered' and ${input.status} = 'sent' then status
             else ${input.status}::message_status
           end,
           ${column},
           error_detail = coalesce(${input.errorDetail ?? null}, error_detail)
     where provider_message_id = ${input.providerMessageId}
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function insertInbound(
  tx: Tx,
  values: typeof inboundMessages.$inferInsert,
): Promise<void> {
  await tx.insert(inboundMessages).values(values).onConflictDoNothing();
}

export async function touchContactWindow(
  tx: Tx,
  tenantId: string,
  phone: string,
  at: Date,
): Promise<void> {
  await tx.execute(sql`
    insert into whatsapp_contact_windows (tenant_id, phone, last_inbound_at)
    values (${tenantId}::uuid, ${phone}, ${at})
    on conflict (tenant_id, phone) do update set last_inbound_at = excluded.last_inbound_at
  `);
}

export async function createAction(
  tx: Tx,
  values: typeof messageActions.$inferInsert,
): Promise<MessageActionRow> {
  const [row] = await tx.insert(messageActions).values(values).returning();
  return row as MessageActionRow;
}

/**
 * Token'ı TEK KULLANIMLIK tüketir.
 *
 * Tüketim `update … where consumed_at is null … returning` ile yapılıyor:
 * "önce bak, sonra işaretle" iki eş zamanlı butona iki kez işlem yaptırırdı.
 */
export async function consumeAction(
  tx: Tx,
  tokenHash: string,
): Promise<MessageActionRow | undefined> {
  const [row] = await tx
    .update(messageActions)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(messageActions.tokenHash, tokenHash),
        isNull(messageActions.consumedAt),
        sql`${messageActions.expiresAt} > now()`,
      ),
    )
    .returning();
  return row;
}

export async function findActionByToken(
  tx: Tx,
  tokenHash: string,
): Promise<MessageActionRow | undefined> {
  const [row] = await tx
    .select()
    .from(messageActions)
    .where(eq(messageActions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function listInbox(
  tx: Tx,
  options: { limit: number; onlyUnhandled: boolean },
): Promise<InboundMessageRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select * from inbound_messages
     where (${options.onlyUnhandled}::boolean is false or handled_at is null)
     order by received_at desc
     limit ${options.limit}
  `);
  return result.rows.map((row) => ({
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    customerId: (row['customer_id'] as string | null) ?? null,
    fromPhone: row['from_phone'] as string,
    waMessageId: row['wa_message_id'] as string,
    messageType: row['message_type'] as string,
    body: (row['body'] as string | null) ?? null,
    mediaId: (row['media_id'] as string | null) ?? null,
    receivedAt: new Date(row['received_at'] as string),
    handledBy: (row['handled_by'] as string | null) ?? null,
    handledAt: row['handled_at'] == null ? null : new Date(row['handled_at'] as string),
  }));
}

export async function markInboundHandled(
  tx: Tx,
  id: string,
  userId: string | null,
): Promise<boolean> {
  const [row] = await tx
    .update(inboundMessages)
    .set({ handledAt: new Date(), handledBy: userId })
    .where(eq(inboundMessages.id, id))
    .returning({ id: inboundMessages.id });
  return row !== undefined;
}

/** Kiracı içindeki müşteriyi E.164 numarasından bulur. */
export async function findCustomerIdByPhone(tx: Tx, phone: string): Promise<string | null> {
  const result = await tx.execute<{ id: string }>(sql`
    select id from customers
     where phone = ${phone} and deleted_at is null
     limit 1
  `);
  return result.rows[0]?.id ?? null;
}

/**
 * Gelen "STOP" talebi. Aktif bir kayıt varsa ikinci satır YAZILMAZ — kısmi
 * tekil indeks bunu zaten engelliyor, `do nothing` yalnız hatayı susturuyor.
 */
export async function insertInboundOptOut(
  tx: Tx,
  tenantId: string,
  customerId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into contact_opt_outs (tenant_id, customer_id, channel, kind, source, note)
    values (${tenantId}::uuid, ${customerId}::uuid, null, 'marketing', 'inbound_stop',
            'WhatsApp üzerinden gelen durdurma talebi')
    on conflict do nothing
  `);
}

/** Kiracının iptal penceresi (saat). Ayar satırı yoksa 24. */
export async function cancelWindowHours(tx: Tx): Promise<number> {
  const result = await tx.execute<{ hours: number }>(sql`
    select cancel_window_hours as hours from tenant_settings limit 1
  `);
  return Number(result.rows[0]?.hours ?? 24);
}

export type { MessageActionKind };
