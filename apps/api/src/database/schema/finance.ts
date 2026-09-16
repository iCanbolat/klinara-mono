import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appointmentServices } from './appointments';
import { customers } from './crm';
import { users } from './identity';
import { customerPackages } from './packages';
import { branches, tenants } from './tenancy';

/**
 * Finans — yalnız BORÇ KALEMLERİ.
 *
 * Tahsilat, kasa, iade, prim ve indirim 0045 ile kapsamdan çıktı; ciro
 * raporları ve dashboard yalnız burada doğan hizmet bedelini okuyor.
 */

export type ChargeSource =
  | 'appointment_service'
  | 'package_sale'
  | 'package_refund'
  | 'product'
  | 'manual';

export type ChargeStatus = 'open' | 'void';

/**
 * Borcun doğduğu yer.
 *
 * Append-only DEĞİL (bkz. `0027`): bu bir belge satırıdır, düzeltilir ve
 * `void` edilir. Değişmezlik ihtiyacını `audit_row_change` karşılar.
 * Aritmetiğin tamamı DB check constraint'lerinde kilitli — uygulama yanlış
 * hesaplarsa satır hiç yazılmaz.
 */
export const charges = pgTable(
  'charges',
  {
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
    source: text('source').$type<ChargeSource>().notNull(),
    appointmentServiceId: uuid('appointment_service_id').references(
      () => appointmentServices.id,
      { onDelete: 'set null' },
    ),
    customerPackageId: uuid('customer_package_id').references(() => customerPackages.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** Katalogdan gelen liste fiyatı — YALNIZ GÖSTERİM, hesaba girmez. */
    unitListPriceMinor: bigint('unit_list_price_minor', { mode: 'number' }).notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    vatRateBasisPoints: integer('vat_rate_basis_points').notNull().default(2000),
    /** KDV DAHİL brüt tutar; `net` ve `vat` bundan türetilir. */
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    netMinor: bigint('net_minor', { mode: 'number' }).notNull(),
    vatMinor: bigint('vat_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    status: text('status').$type<ChargeStatus>().notNull().default('open'),
    priceOverrideReason: text('price_override_reason'),
    priceOverriddenBy: uuid('price_overridden_by').references(() => users.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidedReason: text('voided_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('charges_customer_idx').on(table.tenantId, table.customerId, table.createdAt),
    index('charges_branch_time_idx').on(table.tenantId, table.branchId, table.createdAt),
    uniqueIndex('charges_appointment_service_once').on(table.appointmentServiceId),
  ],
);
