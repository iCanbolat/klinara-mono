import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { customers } from './crm';
import { users } from './identity';
import { tenants } from './tenancy';

export type ConversationStatus = 'open' | 'closed';
export type ConversationDirection = 'in' | 'out';

/**
 * WhatsApp sohbeti — bir NUMARAYA bağlı (0048).
 *
 * Mesajlar burada değil: gelenler `inbound_messages`ta, gidenler
 * `message_log`da; ikisi de `conversation_id` taşıyor.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    status: text('status').$type<ConversationStatus>().notNull().default('open'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text('last_message_preview'),
    lastMessageDirection: text('last_message_direction').$type<ConversationDirection>(),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('conversations_phone_key').on(table.tenantId, table.phone),
    index('conversations_list_idx').on(table.tenantId, table.status, table.lastMessageAt, table.id),
  ],
);
