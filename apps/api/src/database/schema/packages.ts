import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { services } from './catalog';
import { citext } from './columns';
import { branches, tenants } from './tenancy';

export const packageDefinitions = pgTable(
  'package_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    slug: citext('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    totalPriceMinor: bigint('total_price_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    validityDays: integer('validity_days'),
    isTransferable: boolean('is_transferable').notNull().default(true),
    isOnlineSellable: boolean('is_online_sellable').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    revision: integer('revision').notNull().default(1),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('package_definitions_tenant_slug_key').on(table.tenantId, table.slug),
    index('package_definitions_tenant_idx').on(table.tenantId, table.createdAt),
  ],
);

export const packageDefinitionItems = pgTable(
  'package_definition_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => packageDefinitions.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('package_definition_items_service_key').on(table.definitionId, table.serviceId),
    index('package_definition_items_definition_idx').on(table.definitionId, table.sortOrder),
  ],
);

export type LedgerEntryType =
  | 'purchase'
  | 'consume'
  | 'refund'
  | 'transfer_in'
  | 'transfer_out'
  | 'expire'
  | 'manual_adjustment';

export type CustomerPackageStatus = 'active' | 'expired' | 'refunded' | 'transferred';

export type PackageRefundSettlement = 'pending' | 'settled';

export const customerPackages = pgTable(
  'customer_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    definitionId: uuid('definition_id').references(() => packageDefinitions.id, {
      onDelete: 'restrict',
    }),
    definitionName: text('definition_name').notNull(),
    definitionRevision: integer('definition_revision').notNull(),
    totalPriceMinor: bigint('total_price_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    isTransferable: boolean('is_transferable').notNull(),
    validityDays: integer('validity_days'),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status').$type<CustomerPackageStatus>().notNull().default('active'),
    remainingSessions: integer('remaining_sessions').notNull().default(0),
    refundedSessions: integer('refunded_sessions').notNull().default(0),
    refundAmountMinor: bigint('refund_amount_minor', { mode: 'number' }).notNull().default(0),
    refundReason: text('refund_reason'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundedBy: uuid('refunded_by'),
    refundSettlementStatus: text('refund_settlement_status').$type<PackageRefundSettlement>(),
    transferredFromPackageId: uuid('transferred_from_package_id'),
    soldBy: uuid('sold_by'),
    note: text('note'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('customer_packages_customer_idx').on(table.tenantId, table.customerId, table.soldAt),
    index('customer_packages_status_idx').on(table.tenantId, table.status),
  ],
);

export const customerPackageItems = pgTable(
  'customer_package_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerPackageId: uuid('customer_package_id')
      .notNull()
      .references(() => customerPackages.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    serviceName: text('service_name').notNull(),
    quantityTotal: integer('quantity_total').notNull(),
    remainingSessions: integer('remaining_sessions').notNull().default(0),
    unitListPriceMinor: bigint('unit_list_price_minor', { mode: 'number' }).notNull(),
    itemTotalMinor: bigint('item_total_minor', { mode: 'number' }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customer_package_items_service_key').on(
      table.customerPackageId,
      table.serviceId,
    ),
    index('customer_package_items_package_idx').on(table.customerPackageId, table.sortOrder),
  ],
);

/**
 * Append-only defter. `klinara_app` üzerinde `update`/`delete` YETKİSİ YOK ve
 * `reject_mutation()` trigger'ı ikinci kilittir — bu tabloya yazılan bir satır
 * bir daha değişmez.
 */
export const packageLedgerEntries = pgTable(
  'package_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerPackageId: uuid('customer_package_id')
      .notNull()
      .references(() => customerPackages.id, { onDelete: 'restrict' }),
    customerPackageItemId: uuid('customer_package_item_id')
      .notNull()
      .references(() => customerPackageItems.id, { onDelete: 'restrict' }),
    entryType: text('entry_type').$type<LedgerEntryType>().notNull(),
    delta: integer('delta').notNull(),
    appointmentId: uuid('appointment_id'),
    appointmentServiceId: uuid('appointment_service_id'),
    actorUserId: uuid('actor_user_id'),
    reason: text('reason'),
    reversesEntryId: uuid('reverses_entry_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('package_ledger_package_idx').on(table.customerPackageId, table.createdAt),
    index('package_ledger_tenant_time_idx').on(table.tenantId, table.createdAt),
  ],
);
