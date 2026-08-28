import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appointments } from './appointments';
import { customers } from './crm';
import { users } from './identity';
import { messageLog } from './notifications';
import { tenants } from './tenancy';

export type WebhookProvider = 'whatsapp';
export type MessageActionKind = 'confirm' | 'cancel';

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').$type<WebhookProvider>().notNull(),
    /** Sağlayıcının olay kimliği — idempotency buradan gelir. */
    eventId: text('event_id').notNull(),
    /** Kiracı imza doğrulandıktan SONRA çözülür; çözülemeyen olay da kaydedilir. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [uniqueIndex('webhook_events_provider_event_key').on(table.provider, table.eventId)],
);

export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Tanınmayan numara olabilir; mesaj yine de kaydedilir. */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    fromPhone: text('from_phone').notNull(),
    waMessageId: text('wa_message_id').notNull(),
    messageType: text('message_type').notNull().default('text'),
    body: text('body'),
    mediaId: text('media_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('inbound_messages_wa_key').on(table.tenantId, table.waMessageId),
    index('inbound_messages_inbox_idx').on(table.tenantId, table.receivedAt),
  ],
);

export const messageActions = pgTable(
  'message_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    messageLogId: uuid('message_log_id').references(() => messageLog.id, { onDelete: 'set null' }),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    action: text('action').$type<MessageActionKind>().notNull(),
    /** Düz token SAKLANMAZ; `sha256` aranır (telefon doğrulama deseni). */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('message_actions_token_key').on(table.tokenHash)],
);
