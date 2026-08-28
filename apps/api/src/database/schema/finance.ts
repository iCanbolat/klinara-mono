import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appointmentServices } from './appointments';
import { citext } from './columns';
import { customers } from './crm';
import { users } from './identity';
import { customerPackages } from './packages';
import { staffProfiles } from './staff';
import { branches, tenants } from './tenancy';

export type ChargeSource =
  | 'appointment_service'
  | 'package_sale'
  | 'package_refund'
  | 'product'
  | 'manual';

export type ChargeStatus = 'open' | 'void';

export type DiscountKind = 'percent' | 'amount';

export type DiscountScope = 'all' | 'service' | 'package';

export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: citext('code'),
    name: text('name').notNull(),
    kind: text('kind').$type<DiscountKind>().notNull(),
    /** `percent` için BAZ PUAN (1500 = %15), `amount` için minor unit. */
    value: integer('value').notNull(),
    scope: text('scope').$type<DiscountScope>().notNull().default('all'),
    /** `services.id` ya da `package_definitions.id` — polimorfik, FK yok. */
    scopeRefId: uuid('scope_ref_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    maxRedemptions: integer('max_redemptions'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('discounts_tenant_code_key').on(table.tenantId, table.code),
    index('discounts_tenant_idx').on(table.tenantId, table.createdAt),
  ],
);

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
    discountId: uuid('discount_id').references(() => discounts.id, { onDelete: 'set null' }),
    discountKind: text('discount_kind').$type<DiscountKind>(),
    discountValue: integer('discount_value'),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
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

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'gift_voucher' | 'other';

export type PaymentStatus = 'posted' | 'void';

export const payments = pgTable(
  'payments',
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
    method: text('method').$type<PaymentMethod>().notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    receiptNo: bigint('receipt_no', { mode: 'number' }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    /** 0029'da açık kasa oturumuna FK ile bağlanır; nakit için zorunlu olur. */
    cashSessionId: uuid('cash_session_id'),
    note: text('note'),
    status: text('status').$type<PaymentStatus>().notNull().default('posted'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidedReason: text('voided_reason'),
    collectedBy: uuid('collected_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_tenant_receipt_key').on(table.tenantId, table.receiptNo),
    index('payments_customer_idx').on(table.tenantId, table.customerId, table.paidAt),
    index('payments_branch_time_idx').on(table.tenantId, table.branchId, table.paidAt),
  ],
);

/**
 * Bir tahsilatın ücret kalemlerine dağıtımı.
 *
 * Append-only: `klinara_app` üzerinde `update`/`delete` YETKİSİ YOK ve
 * `reject_mutation()` trigger'ı ikinci kilittir — bir kalemin ne kadarının
 * kapandığı bu satırlardan TÜRETİLİR.
 */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charges.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_allocations_pair_key').on(table.paymentId, table.chargeId),
    index('payment_allocations_charge_idx').on(table.chargeId),
  ],
);

export const receiptSequences = pgTable('receipt_sequences', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CashMovementKind = 'opening' | 'payment' | 'refund' | 'payout' | 'deposit';

export type RefundKind = 'package' | 'service' | 'other';

/**
 * Vardiya bazlı kasa oturumu.
 *
 * Açıklık `closedAt is null` ile TÜRETİLİR; ayrı bir `status` kolonu, senkron
 * tutulması gereken ikinci bir gerçek olurdu. Şube başına tek açık oturum
 * kuralını `cash_sessions_single_open_key` kısmi tekil indeksi zorlar.
 */
export const cashRegisterSessions = pgTable(
  'cash_register_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    openedBy: uuid('opened_by').references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    openingBalanceMinor: bigint('opening_balance_minor', { mode: 'number' })
      .notNull()
      .default(0),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    expectedMinor: bigint('expected_minor', { mode: 'number' }),
    countedMinor: bigint('counted_minor', { mode: 'number' }),
    differenceMinor: bigint('difference_minor', { mode: 'number' }),
    differenceReason: text('difference_reason'),
    currency: text('currency').notNull().default('TRY'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cash_sessions_branch_idx').on(table.tenantId, table.branchId, table.openedAt),
  ],
);

/** Append-only kasa dökümü; tutar İŞARETLİDİR (giriş +, çıkış −). */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => cashRegisterSessions.id, { onDelete: 'restrict' }),
    kind: text('kind').$type<CashMovementKind>().notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'restrict' }),
    refundId: uuid('refund_id'),
    note: text('note'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cash_movements_session_idx').on(table.sessionId, table.createdAt),
    uniqueIndex('cash_movements_payment_once').on(table.paymentId),
  ],
);

export const refunds = pgTable(
  'refunds',
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
    kind: text('kind').$type<RefundKind>().notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    method: text('method').$type<PaymentMethod>().notNull(),
    chargeId: uuid('charge_id').references(() => charges.id, { onDelete: 'restrict' }),
    customerPackageId: uuid('customer_package_id').references(() => customerPackages.id, {
      onDelete: 'restrict',
    }),
    cashSessionId: uuid('cash_session_id').references(() => cashRegisterSessions.id, {
      onDelete: 'restrict',
    }),
    reason: text('reason').notNull(),
    refundedBy: uuid('refunded_by').references(() => users.id),
    refundedAt: timestamp('refunded_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refunds_customer_idx').on(table.tenantId, table.customerId, table.refundedAt),
    uniqueIndex('refunds_charge_once').on(table.chargeId),
  ],
);

export type CommissionScope = 'global' | 'service' | 'package' | 'product';
export type CommissionCalcKind = 'percent' | 'fixed';
export type CommissionBasis = 'service_price' | 'net_after_discount' | 'collected_amount';
export type CommissionTrigger = 'service_completed' | 'payment_received';
export type CommissionPeriodStatus = 'open' | 'closed';

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    scope: text('scope').$type<CommissionScope>().notNull().default('global'),
    /** `services.id` ya da `package_definitions.id` — polimorfik, FK yok. */
    scopeRefId: uuid('scope_ref_id'),
    /** null = tüm personel; dolu = personel bazlı override. */
    staffProfileId: uuid('staff_profile_id').references(() => staffProfiles.id, {
      onDelete: 'cascade',
    }),
    calcKind: text('calc_kind').$type<CommissionCalcKind>().notNull(),
    /** `percent` için BAZ PUAN (1000 = %10), `fixed` için minor unit. */
    value: integer('value').notNull(),
    basis: text('basis').$type<CommissionBasis>().notNull().default('net_after_discount'),
    triggerOn: text('trigger_on')
      .$type<CommissionTrigger>()
      .notNull()
      .default('service_completed'),
    priority: integer('priority').notNull().default(0),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('commission_rules_tenant_idx').on(table.tenantId, table.createdAt)],
);

export const commissionPeriods = pgTable(
  'commission_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: text('status').$type<CommissionPeriodStatus>().notNull().default('open'),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('commission_periods_key').on(table.tenantId, table.branchId, table.startsOn),
  ],
);

/**
 * Prim tahakkukları — APPEND-ONLY.
 *
 * Prim bir para taahhüdüdür; iptal satırı silmekle değil TERS KAYITLA olur.
 * Kural bilgisi satış anındaki hâliyle kopyalanır: kural sonradan değişse bu
 * tahakkuk kıpırdamaz.
 */
export const commissionAccruals = pgTable(
  'commission_accruals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    staffProfileId: uuid('staff_profile_id')
      .notNull()
      .references(() => staffProfiles.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => commissionPeriods.id, { onDelete: 'restrict' }),
    ruleId: uuid('rule_id').references(() => commissionRules.id, { onDelete: 'set null' }),
    ruleCalcKind: text('rule_calc_kind').$type<CommissionCalcKind>().notNull(),
    ruleValue: integer('rule_value').notNull(),
    ruleBasis: text('rule_basis').$type<CommissionBasis>().notNull(),
    triggerOn: text('trigger_on').$type<CommissionTrigger>().notNull(),
    chargeId: uuid('charge_id').references(() => charges.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'restrict' }),
    basisMinor: bigint('basis_minor', { mode: 'number' }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    reversesAccrualId: uuid('reverses_accrual_id'),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('commission_accruals_staff_idx').on(
      table.tenantId,
      table.staffProfileId,
      table.createdAt,
    ),
    index('commission_accruals_period_idx').on(table.periodId, table.staffProfileId),
  ],
);
