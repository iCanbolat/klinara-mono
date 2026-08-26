import {
  boolean,
  char,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, integerArray } from './columns';

export const tenantStatus = pgEnum('tenant_status', ['trial', 'active', 'suspended']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('trial'),
  timezone: text('timezone').notNull().default('Europe/Istanbul'),
  currency: char('currency', { length: 3 }).notNull().default('TRY'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: citext('slug').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Europe/Istanbul'),
    phone: text('phone'),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('branches_tenant_slug_key').on(table.tenantId, table.slug)],
);

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  slotGranularityMinutes: integer('slot_granularity_minutes').notNull().default(15),
  preventCustomerDoubleBooking: boolean('prevent_customer_double_booking').notNull().default(true),
  reminderHoursBefore: integerArray('reminder_hours_before').notNull(),
  cancelWindowHours: integer('cancel_window_hours').notNull().default(24),
  /** Yönetici rolleri (owner, manager, accountant) için 2FA zorunlu mu. */
  requireMfaForAdmins: boolean('require_mfa_for_admins').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
