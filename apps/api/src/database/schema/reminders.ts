import { integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boolean } from 'drizzle-orm/pg-core';
import { appointments } from './appointments';
import { integerArray } from './columns';
import { messageLog, type NotificationEvent } from './notifications';
import { branches, tenants } from './tenancy';
import { text } from 'drizzle-orm/pg-core';

export type ScheduledNotificationStatus = 'pending' | 'sent' | 'cancelled' | 'superseded';

export const branchNotificationSettings = pgTable('branch_notification_settings', {
  branchId: uuid('branch_id')
    .primaryKey()
    .references(() => branches.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Boş dizi = şube ayarı yok; `tenant_settings.reminder_hours_before` geçerli. */
  reminderHoursBefore: integerArray('reminder_hours_before').notNull().default([]),
  noShowFollowupEnabled: boolean('no_show_followup_enabled').notNull().default(true),
  noShowFollowupDelayHours: integer('no_show_followup_delay_hours').notNull().default(2),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledNotifications = pgTable(
  'scheduled_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    event: text('event').$type<NotificationEvent>().notNull(),
    /** Randevudan kaç saat önce; no-show takibinde negatif (sonra gider). */
    offsetHours: integer('offset_hours').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    messageLogId: uuid('message_log_id').references(() => messageLog.id, { onDelete: 'set null' }),
    status: text('status').$type<ScheduledNotificationStatus>().notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('scheduled_notifications_pending_key').on(
      table.appointmentId,
      table.event,
      table.offsetHours,
    ),
  ],
);
