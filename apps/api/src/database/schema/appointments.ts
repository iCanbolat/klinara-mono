import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tstzrange } from './columns';
import { branches, tenants } from './tenancy';
import { users } from './identity';
import { customers } from './crm';
import { services } from './catalog';
import { staffProfiles } from './staff';

export const appointmentStatus = pgEnum('appointment_status', [
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'completed',
  'no_show',
  'cancelled',
]);
export const appointmentOrigin = pgEnum('appointment_origin', ['internal', 'online']);
export const resourceType = pgEnum('resource_type', ['staff']);
export const bookingSource = pgEnum('booking_source', ['appointment', 'hold']);

export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number];

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'restrict' }),
  status: appointmentStatus('status').notNull().default('scheduled'),
  /** Müşteriye gösterilen aralık — buffer DAHİL DEĞİL. */
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  origin: appointmentOrigin('origin').notNull().default('internal'),
  notes: text('notes'),
  cancellationReason: text('cancellation_reason'),
  cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** Trigger tarafından artırılır; `If-Match` ile eşleşmesi beklenir. */
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const appointmentServices = pgTable(
  'appointment_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    staffProfileId: uuid('staff_profile_id')
      .notNull()
      .references(() => staffProfiles.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    // Snapshot alanları: katalog sonradan değişse de randevunun tutarı ve
    // süresi değişmez.
    durationMinutes: integer('duration_minutes').notNull(),
    bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
    bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(0),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    vatRateBasisPoints: integer('vat_rate_basis_points').notNull().default(2000),
    // Faz 5.3 — bu kalem bir paketten mi düşülüyor ve düşüldü mü.
    customerPackageItemId: uuid('customer_package_item_id'),
    packageConsumedEntryId: uuid('package_consumed_entry_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('appointment_services_order_key').on(table.appointmentId, table.sortOrder),
  ],
);

export const resourceBookings = pgTable('resource_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'restrict' }),
  resourceType: resourceType('resource_type').notNull(),
  /** `staff_profiles.id` — kaynak türü genişleyeceği için FK yok. */
  resourceId: uuid('resource_id').notNull(),
  sourceType: bookingSource('source_type').notNull(),
  appointmentId: uuid('appointment_id').references(() => appointments.id, {
    onDelete: 'cascade',
  }),
  /** Faz 9'da `slot_holds`a bağlanacak. */
  holdId: uuid('hold_id'),
  /** Buffer DAHİL aralık, `[)`. */
  timeRange: tstzrange('time_range').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerBookings = pgTable('customer_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => appointments.id, { onDelete: 'cascade' }),
  timeRange: tstzrange('time_range').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * İzinli durum geçişleri — REFERANS VERİ.
 *
 * Uygulama yalnız okur (`grant select`); satırları migration yazar.
 * `requiredPermission` dolu bir geçiş, servis katmanında ayrıca izin kontrolü
 * ister — veritabanı izinlerimizi bilmez.
 */
export const appointmentStatusTransitions = pgTable('appointment_status_transitions', {
  fromStatus: appointmentStatus('from_status').notNull(),
  toStatus: appointmentStatus('to_status').notNull(),
  requiredPermission: text('required_permission'),
});

export const appointmentHistoryAction = pgEnum('appointment_history_action', [
  'created',
  'rescheduled',
  'status_changed',
  'cancelled',
  'updated',
]);

/**
 * Randevunun İŞ olayları — kullanıcıya gösterilen geçmiş.
 *
 * `audit_log`tan ayrıdır: o teknik bir iz (satır öncesi/sonrası JSON), bu ise
 * "kim erteledi, neden iptal etti" sorusunun cevabı. Append-only; UPDATE/DELETE
 * trigger ile engellidir.
 */
export const appointmentHistory = pgTable('appointment_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => appointments.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: appointmentHistoryAction('action').notNull(),
  fromStatus: appointmentStatus('from_status'),
  toStatus: appointmentStatus('to_status'),
  oldStartsAt: timestamp('old_starts_at', { withTimezone: true }),
  newStartsAt: timestamp('new_starts_at', { withTimezone: true }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Idempotency kayıtları (API sözleşmesi 5.6). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.key] })],
);
