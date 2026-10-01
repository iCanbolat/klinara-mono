import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { textArray } from './columns';
import { appointments } from './appointments';
import { conversations } from './conversations';
import { customers } from './crm';
import { users } from './identity';
import { branches, tenants } from './tenancy';

/**
 * Wire düzeyi kanal kümesi. DB enum'u geçmiş satırlar için `sms` değerini
 * hâlâ taşıyor (Postgres enum değeri düşürülemez); uygulama onu artık üretmez.
 */
export type NotificationChannel = 'whatsapp' | 'email' | 'push';

export type NotificationEvent =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'appointment_cancelled'
  | 'no_show_followup'
  | 'package_balance'
  | 'package_expiring'
  | 'auto_reply'
  | 'staff_reply'
  | 'staff_internal';

export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped';

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
    /** Sohbet ekranı (0048): resepsiyonun yazdığı cevaplar bu kimliği taşır. */
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    /** Mesajın hakkında olduğu randevu — hatırlatma butonları token'ı buradan üretir. */
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    /** Elle yazılmış cevabın yazarı; otomatik bildirimlerde boş. */
    sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('message_log_tenant_created_idx').on(table.tenantId, table.createdAt, table.id),
  ],
);

export type StaffNotificationKind =
  | 'appointment_created'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'inbound_message'
  | 'delivery_failed';

/** Panelin zil ikonuna düşen bildirimler — kliniğe ait, kişiye değil. */
export const staffNotifications = pgTable(
  'staff_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<StaffNotificationKind>().notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Tıklayınca gidilecek panel yolu. */
    link: text('link'),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'cascade',
    }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('staff_notifications_feed_idx').on(table.tenantId, table.createdAt, table.id)],
);

/** Okundu bilgisi KİŞİSEL: biri okuyunca ötekinin sayacı düşmez. */
export const staffNotificationReads = pgTable(
  'staff_notification_reads',
  {
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => staffNotifications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('staff_notification_reads_user_idx').on(table.tenantId, table.userId)],
);

