import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { textArray } from './columns';
import { customers } from './crm';
import { users } from './identity';
import { branches, tenants } from './tenancy';

export type NotificationChannel = 'whatsapp' | 'sms' | 'email' | 'push';

export type NotificationEvent =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'appointment_cancelled'
  | 'no_show_followup'
  | 'package_balance'
  | 'package_expiring'
  | 'birthday'
  | 'auto_reply'
  | 'staff_internal';

export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped';

/** İşlemsel ileti opt-out'tan etkilenmez; pazarlama iletisi etkilenir. */
export type NotificationKind = 'transactional' | 'marketing';

export type OptOutSource = 'customer_request' | 'inbound_stop' | 'staff';

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    event: text('event').$type<NotificationEvent>().notNull(),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    locale: text('locale').notNull().default('tr'),
    subject: text('subject'),
    body: text('body').notNull(),
    /** Meta'da onaylı template adı — metin oradan gelir, bizden değil (8.2). */
    whatsappTemplateName: text('whatsapp_template_name'),
    whatsappTemplateLanguage: text('whatsapp_template_language'),
    /**
     * Meta template'inin konumsal değişkenleri (`{{1}}`…) hangi adlı
     * değişkenimize karşılık geliyor — sırayla.
     */
    whatsappVariables: textArray('whatsapp_variables').notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_templates_key').on(
      table.tenantId,
      table.event,
      table.channel,
      table.locale,
    ),
  ],
);

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** `null` = kiracı varsayılanı; şube satırı onu ezer. */
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  event: text('event').$type<NotificationEvent>().notNull(),
  /** Denenecek kanallar, öncelik sırasında. Boş dizi = olay kapalı. */
  channels: textArray('channels').$type<NotificationChannel[]>().notNull(),
  /** Şube saat diliminde yorumlanır; gece yarısını aşan pencere geçerlidir. */
  quietHoursStart: time('quiet_hours_start'),
  quietHoursEnd: time('quiet_hours_end'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageLog = pgTable(
  'message_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    event: text('event').$type<NotificationEvent>().notNull(),
    kind: text('kind').$type<NotificationKind>().notNull().default('transactional'),
    status: text('status').$type<MessageStatus>().notNull().default('queued'),
    /** Ham adres SAKLANMAZ: `+90**********67`. */
    toMasked: text('to_masked').notNull(),
    templateId: uuid('template_id').references(() => notificationTemplates.id, {
      onDelete: 'set null',
    }),
    renderedSubject: text('rendered_subject'),
    renderedBody: text('rendered_body'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    attempt: integer('attempt').notNull().default(0),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    /** Template gönderiminde Meta'ya giden parametre değerleri. */
    templateVariables: jsonb('template_variables').$type<Record<string, string>>(),
    /** Çift gönderim koruması — kısmi tekil indeks (`failed` hariç). */
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('message_log_tenant_created_idx').on(table.tenantId, table.createdAt, table.id),
  ],
);

export const contactOptOuts = pgTable('contact_opt_outs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  /** `null` = tüm kanallar. */
  channel: text('channel').$type<NotificationChannel>(),
  kind: text('kind').$type<NotificationKind>().notNull().default('marketing'),
  source: text('source').$type<OptOutSource>().notNull().default('customer_request'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Satır silinmez; geri alma bu alanı doldurur. */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
});
