import { sql } from 'drizzle-orm';
import type { ConversationStatus } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export interface ConversationRow {
  id: string;
  phone: string;
  customerId: string | null;
  customerName: string | null;
  status: ConversationStatus;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
  lastMessageDirection: 'in' | 'out' | null;
  lastInboundAt: Date | null;
  lastReadAt: Date | null;
  closedAt: Date | null;
}

export interface ThreadRow {
  id: string;
  direction: 'in' | 'out';
  messageType: string;
  body: string | null;
  at: Date;
  status: string | null;
  event: string | null;
  sentByName: string | null;
  errorDetail: string | null;
  appointmentId: string | null;
}

/** Liste satırındaki önizleme — tam metin akışta duruyor. */
const PREVIEW_LENGTH = 140;

export const previewOf = (body: string | null, fallback: string): string =>
  (body ?? fallback).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);

const date = (value: unknown): Date | null => (value == null ? null : new Date(value as string));

function hydrate(row: Record<string, unknown>): ConversationRow {
  return {
    id: row['id'] as string,
    phone: row['phone'] as string,
    customerId: (row['customer_id'] as string | null) ?? null,
    customerName: (row['customer_name'] as string | null) ?? null,
    status: row['status'] as ConversationStatus,
    lastMessageAt: date(row['last_message_at']) as Date,
    lastMessagePreview: (row['last_message_preview'] as string | null) ?? null,
    lastMessageDirection: (row['last_message_direction'] as 'in' | 'out' | null) ?? null,
    lastInboundAt: date(row['last_inbound_at']),
    lastReadAt: date(row['last_read_at']),
    closedAt: date(row['closed_at']),
  };
}

const SELECT = sql`
  select c.id, c.phone, c.customer_id, cu.full_name as customer_name, c.status::text as status,
         c.last_message_at, c.last_message_preview, c.last_message_direction,
         c.last_inbound_at, c.last_read_at, c.closed_at
    from conversations c
    left join customers cu on cu.id = c.customer_id and cu.deleted_at is null
`;

/**
 * Gelen mesajla sohbeti açar ya da günceller; kimliği döner.
 *
 * Kapalı bir sohbete yazan müşteri onu YENİDEN AÇAR: kapatmak "bu konu bitti"
 * demek, "bu kişiyi dinlemiyoruz" değil.
 *
 * Müşteri eşleşmesi yalnız BOŞSA yazılır: resepsiyonun elle bağladığı müşteri,
 * aynı numaranın sonradan başka bir kayıtta da görünmesiyle ezilmemeli.
 */
export async function upsertOnInbound(
  tx: Tx,
  input: { tenantId: string; phone: string; customerId: string | null; at: Date; preview: string },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    insert into conversations
      (tenant_id, phone, customer_id, status, last_message_at, last_message_preview,
       last_message_direction, last_inbound_at)
    values
      (${input.tenantId}::uuid, ${input.phone}, ${input.customerId}::uuid, 'open', ${input.at},
       ${input.preview}, 'in', ${input.at})
    on conflict (tenant_id, phone) do update set
      customer_id = coalesce(conversations.customer_id, excluded.customer_id),
      status = 'open',
      closed_at = null,
      closed_by = null,
      last_message_at = greatest(conversations.last_message_at, excluded.last_message_at),
      last_message_preview = excluded.last_message_preview,
      last_message_direction = 'in',
      last_inbound_at = greatest(
        coalesce(conversations.last_inbound_at, excluded.last_inbound_at),
        excluded.last_inbound_at
      ),
      -- Yeni mesaj sohbeti OKUNMAMIŞ yapar. Zaman karşılaştırmasına
      -- bırakılamaz: Meta'nın zaman damgası saniye hassasiyetinde ve
      -- resepsiyonun okuduğu saniye içinde gelen mesaj "okunmuş" sayılırdı.
      last_read_at = null,
      updated_at = now()
    returning id
  `);
  return (result.rows[0] as { id: string }).id;
}

/** Giden cevap: önizleme güncellenir ve sohbet OKUNDU sayılır (cevap yazan okumuştur). */
export async function touchOutbound(
  tx: Tx,
  id: string,
  input: { at: Date; preview: string },
): Promise<void> {
  await tx.execute(sql`
    update conversations
       set last_message_at = greatest(last_message_at, ${input.at}),
           last_message_preview = ${input.preview},
           last_message_direction = 'out',
           last_read_at = ${input.at},
           updated_at = now()
     where id = ${id}::uuid
  `);
}

export async function list(
  tx: Tx,
  options: {
    status: ConversationStatus | 'all';
    unreadOnly: boolean;
    limit: number;
    cursor?: { at: string; id: string } | undefined;
  },
): Promise<ConversationRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    ${SELECT}
     where (${options.status}::text = 'all' or c.status::text = ${options.status}::text)
       and (${options.unreadOnly}::boolean is false
            or c.last_inbound_at > coalesce(c.last_read_at, '-infinity'::timestamptz))
       and (${options.cursor?.at ?? null}::timestamptz is null
            or (c.last_message_at, c.id) < (${options.cursor?.at ?? null}::timestamptz,
                                             ${options.cursor?.id ?? null}::uuid))
     order by c.last_message_at desc, c.id desc
     limit ${options.limit}
  `);
  return result.rows.map(hydrate);
}

export async function findById(tx: Tx, id: string): Promise<ConversationRow | undefined> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    ${SELECT}
     where c.id = ${id}::uuid
     limit 1
  `);
  const row = result.rows[0];
  return row === undefined ? undefined : hydrate(row);
}

/** Açık ve okunmamış sohbet sayısı — menü rozeti. */
export async function countUnread(tx: Tx): Promise<number> {
  const result = await tx.execute<{ count: string | number }>(sql`
    select count(*) as count
      from conversations
     where status = 'open'
       and last_inbound_at > coalesce(last_read_at, '-infinity'::timestamptz)
  `);
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Sohbetin akışı: gelenler + gidenler, kronolojik.
 *
 * Giden mesajlar iki yoldan bağlanıyor: resepsiyonun cevabı `conversation_id`
 * taşıyor, otomatik bildirimler (hatırlatma, otomatik cevap) ise yalnız
 * `customer_id` — bildirim çekirdeği sohbet bilmiyor ve bilmemeli.
 */
export async function thread(
  tx: Tx,
  conversation: { id: string; customerId: string | null },
  limit: number,
): Promise<ThreadRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select * from (
      select i.id, 'in' as direction, i.message_type, i.body, i.received_at as at,
             null::text as status, null::text as event, null::text as sent_by_name,
             null::text as error_detail, null::uuid as appointment_id
        from inbound_messages i
       where i.conversation_id = ${conversation.id}::uuid
      union all
      select m.id, 'out' as direction,
             case when m.event::text in ('staff_reply', 'auto_reply')
                   and not (coalesce(m.template_variables, '{}'::jsonb) ? 'templateName')
                  then 'text' else 'template' end,
             m.rendered_body, m.created_at as at, m.status::text, m.event::text, u.full_name,
             m.error_detail, m.appointment_id
        from message_log m
        left join users u on u.id = m.sent_by_user_id
       where m.channel = 'whatsapp'
         and (m.conversation_id = ${conversation.id}::uuid
              or (${conversation.customerId}::uuid is not null
                  and m.customer_id = ${conversation.customerId}::uuid
                  and m.conversation_id is null))
    ) t
    order by at desc, id desc
    limit ${limit}
  `);

  return result.rows
    .map((row) => ({
      id: row['id'] as string,
      direction: row['direction'] as 'in' | 'out',
      messageType: row['message_type'] as string,
      body: (row['body'] as string | null) ?? null,
      at: new Date(row['at'] as string),
      status: (row['status'] as string | null) ?? null,
      event: (row['event'] as string | null) ?? null,
      sentByName: (row['sent_by_name'] as string | null) ?? null,
      errorDetail: (row['error_detail'] as string | null) ?? null,
      appointmentId: (row['appointment_id'] as string | null) ?? null,
    }))
    .reverse();
}

export async function markRead(tx: Tx, id: string): Promise<boolean> {
  const result = await tx.execute(sql`
    update conversations set last_read_at = now(), updated_at = now() where id = ${id}::uuid
  `);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Kapatma, sohbetin bekleyen gelen mesajlarını da İŞLENDİ sayar: eski gelen
 * kutusu (mobil) aynı mesajları ayrıca "bekliyor" diye göstermesin.
 */
export async function setStatus(
  tx: Tx,
  id: string,
  status: ConversationStatus,
  userId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    update conversations
       set status = ${status}::conversation_status,
           closed_at = case when ${status}::text = 'closed' then now() else null end,
           closed_by = case when ${status}::text = 'closed' then ${userId}::uuid else null end,
           last_read_at = case when ${status}::text = 'closed' then now() else last_read_at end,
           updated_at = now()
     where id = ${id}::uuid
  `);
  if (status === 'closed') {
    await tx.execute(sql`
      update inbound_messages
         set handled_at = now(), handled_by = ${userId}::uuid
       where conversation_id = ${id}::uuid and handled_at is null
    `);
  }
  return (result.rowCount ?? 0) > 0;
}

/** Müşteri bağlama; sohbetin geçmiş gelen mesajları da o müşteriye yazılır. */
export async function linkCustomer(tx: Tx, id: string, customerId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    update conversations set customer_id = ${customerId}::uuid, updated_at = now()
     where id = ${id}::uuid
  `);
  await tx.execute(sql`
    update inbound_messages set customer_id = ${customerId}::uuid
     where conversation_id = ${id}::uuid and customer_id is null
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function customerExists(tx: Tx, customerId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    select 1 from customers where id = ${customerId}::uuid and deleted_at is null limit 1
  `);
  return result.rows.length > 0;
}

/** Şablon önerisi için: müşterinin en yakın ileri tarihli etkin randevusu. */
export async function nextAppointmentId(
  tx: Tx,
  customerId: string,
  now: Date,
): Promise<string | undefined> {
  const result = await tx.execute<{ id: string }>(sql`
    select id from appointments
     where customer_id = ${customerId}::uuid
       and status in ('scheduled', 'confirmed')
       and starts_at > ${now.toISOString()}::timestamptz
     order by starts_at
     limit 1
  `);
  return result.rows[0]?.id;
}

/**
 * Şablondaki `branchName` önerisi: müşterinin son randevusunun şubesi, yoksa
 * kiracının ilk açılan şubesi.
 */
export async function suggestedBranchName(
  tx: Tx,
  customerId: string | null,
): Promise<string | undefined> {
  const result = await tx.execute<{ name: string }>(sql`
    select b.name from branches b
      left join lateral (
        select max(a.starts_at) as last_at from appointments a
         where a.branch_id = b.id and a.customer_id = ${customerId}::uuid
      ) recent on true
     where b.deleted_at is null and b.is_active
     order by recent.last_at desc nulls last, b.created_at
     limit 1
  `);
  return result.rows[0]?.name;
}
