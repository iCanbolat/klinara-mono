import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { textArray } from './columns';
import { branches, tenants } from './tenancy';
import { users } from './identity';
import { services } from './catalog';

export const staffProfiles = pgTable(
  'staff_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    primaryBranchId: uuid('primary_branch_id').references(() => branches.id, { onDelete: 'set null' }),
    title: text('title'),
    specialties: textArray('specialties').notNull(),
    calendarColor: text('calendar_color'),
    bio: text('bio'),
    isVisibleOnline: boolean('is_visible_online').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('staff_profiles_tenant_user_key').on(table.tenantId, table.userId)],
);

export const staffServices = pgTable(
  'staff_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffProfileId: uuid('staff_profile_id')
      .notNull()
      .references(() => staffProfiles.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    customDurationMinutes: integer('custom_duration_minutes'),
    customPriceMinor: bigint('custom_price_minor', { mode: 'number' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('staff_services_profile_service_branch_key').on(
      table.staffProfileId,
      table.serviceId,
      table.branchId,
    ),
  ],
);
