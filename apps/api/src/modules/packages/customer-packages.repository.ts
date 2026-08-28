import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  customerPackageItems,
  customerPackages,
  packageLedgerEntries,
  type CustomerPackageStatus,
  type LedgerEntryType,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, type Updatable } from '../../database/updates';

export type CustomerPackageRow = typeof customerPackages.$inferSelect;
export type CustomerPackageItemRow = typeof customerPackageItems.$inferSelect;
export type PackageLedgerRow = typeof packageLedgerEntries.$inferSelect;

export async function insertPackage(
  tx: Tx,
  values: typeof customerPackages.$inferInsert,
): Promise<CustomerPackageRow> {
  const [row] = await tx.insert(customerPackages).values(values).returning();
  if (row === undefined) throw new Error('Müşteri paketi yazılamadı');
  return row;
}

export async function insertItems(
  tx: Tx,
  values: (typeof customerPackageItems.$inferInsert)[],
): Promise<CustomerPackageItemRow[]> {
  if (values.length === 0) return [];
  return tx.insert(customerPackageItems).values(values).returning();
}

/**
 * Defter satırı yazmak, bakiyeyi değiştirmenin TEK yoludur.
 *
 * `remaining_sessions` hiçbir servis yolundan doğrudan yazılmaz; apply
 * trigger'ı bu insert'in ardından günceller ve hak yetmezse K0004 fırlatır.
 */
export async function insertLedgerEntry(
  tx: Tx,
  values: {
    tenantId: string;
    customerPackageId: string;
    customerPackageItemId: string;
    entryType: LedgerEntryType;
    delta: number;
    appointmentId?: string | null;
    appointmentServiceId?: string | null;
    actorUserId?: string | null;
    reason?: string | null;
    reversesEntryId?: string | null;
  },
): Promise<PackageLedgerRow> {
  const [row] = await tx.insert(packageLedgerEntries).values(values).returning();
  if (row === undefined) throw new Error('Defter satırı yazılamadı');
  return row;
}

export async function findPackageById(
  tx: Tx,
  id: string,
): Promise<CustomerPackageRow | undefined> {
  const [row] = await tx
    .select()
    .from(customerPackages)
    .where(and(eq(customerPackages.id, id), isNull(customerPackages.deletedAt)));
  return row;
}

/** Yazma yolunda satırı KİLİTLİ okur — sürüm kontrolünden önce. */
export async function lockPackageById(
  tx: Tx,
  id: string,
): Promise<CustomerPackageRow | undefined> {
  const [row] = await tx
    .select()
    .from(customerPackages)
    .where(and(eq(customerPackages.id, id), isNull(customerPackages.deletedAt)))
    .for('update');
  return row;
}

interface ListFilters {
  customerId: string;
  limit: number;
  cursorSoldAt?: string | undefined;
  cursorId?: string | undefined;
  status?: CustomerPackageStatus | undefined;
}

export async function listPackagesForCustomer(
  tx: Tx,
  filters: ListFilters,
): Promise<CustomerPackageRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select p.*
      from customer_packages p
     where p.deleted_at is null
       and p.customer_id = ${filters.customerId}::uuid
       and (${filters.status ?? null}::text is null
            or p.status::text = ${filters.status ?? null}::text)
       and (${filters.cursorSoldAt ?? null}::timestamptz is null
            or (p.sold_at, p.id)
               < (${filters.cursorSoldAt ?? null}::timestamptz, ${filters.cursorId ?? null}::uuid))
     order by p.sold_at desc, p.id desc
     limit ${filters.limit}
  `);
  return result.rows.map(hydratePackage);
}

export async function listItemsForPackages(
  tx: Tx,
  packageIds: string[],
): Promise<Map<string, CustomerPackageItemRow[]>> {
  const grouped = new Map<string, CustomerPackageItemRow[]>();
  if (packageIds.length === 0) return grouped;

  const rows = await tx
    .select()
    .from(customerPackageItems)
    .where(inArray(customerPackageItems.customerPackageId, packageIds))
    .orderBy(asc(customerPackageItems.sortOrder), asc(customerPackageItems.id));

  for (const row of rows) {
    const bucket = grouped.get(row.customerPackageId);
    if (bucket === undefined) grouped.set(row.customerPackageId, [row]);
    else bucket.push(row);
  }
  return grouped;
}

export async function listItemsForPackage(
  tx: Tx,
  packageId: string,
): Promise<CustomerPackageItemRow[]> {
  return tx
    .select()
    .from(customerPackageItems)
    .where(eq(customerPackageItems.customerPackageId, packageId))
    .orderBy(asc(customerPackageItems.sortOrder), asc(customerPackageItems.id));
}

/** Yazma yolunda kalemleri SABİT SIRAYLA kilitler — deadlock önlemi. */
export async function lockItemsForPackage(
  tx: Tx,
  packageId: string,
): Promise<CustomerPackageItemRow[]> {
  return tx
    .select()
    .from(customerPackageItems)
    .where(eq(customerPackageItems.customerPackageId, packageId))
    .orderBy(asc(customerPackageItems.id))
    .for('update');
}

export interface LedgerEntryWithService extends PackageLedgerRow {
  serviceId: string;
  serviceName: string;
}

export async function listLedger(
  tx: Tx,
  filters: {
    customerPackageId: string;
    limit: number;
    cursorCreatedAt?: string | undefined;
    cursorId?: string | undefined;
  },
): Promise<LedgerEntryWithService[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select e.*, i.service_id, i.service_name
      from package_ledger_entries e
      join customer_package_items i on i.id = e.customer_package_item_id
     where e.customer_package_id = ${filters.customerPackageId}::uuid
       and (${filters.cursorCreatedAt ?? null}::timestamptz is null
            or (e.created_at, e.id)
               < (${filters.cursorCreatedAt ?? null}::timestamptz, ${filters.cursorId ?? null}::uuid))
     order by e.created_at desc, e.id desc
     limit ${filters.limit}
  `);
  return result.rows.map((row) => ({
    id: row.id as string,
    tenantId: row.tenant_id as string,
    customerPackageId: row.customer_package_id as string,
    customerPackageItemId: row.customer_package_item_id as string,
    entryType: row.entry_type as LedgerEntryType,
    delta: Number(row.delta),
    appointmentId: (row.appointment_id ?? null) as string | null,
    appointmentServiceId: (row.appointment_service_id ?? null) as string | null,
    actorUserId: (row.actor_user_id ?? null) as string | null,
    reason: (row.reason ?? null) as string | null,
    reversesEntryId: (row.reverses_entry_id ?? null) as string | null,
    createdAt: new Date(row.created_at as string),
    serviceId: row.service_id as string,
    serviceName: row.service_name as string,
  }));
}

/**
 * Sürüm koşulu OLMADAN günceller.
 *
 * Yalnızca satır `lockPackageById` ile kilitlenmiş ve sürümü elle
 * doğrulanmışken kullanılır. Sürüm koşulu burada işe yaramazdı: aradaki defter
 * yazımları apply trigger'ı üzerinden `version`ı zaten artırmış oluyor, yani
 * `where version = $beklenen` 0 satır günceller ve yama SESSİZCE düşerdi.
 */
export async function updatePackage(
  tx: Tx,
  id: string,
  values: Updatable<{
    status: CustomerPackageStatus;
    refundedSessions: number;
    refundAmountMinor: number;
    refundReason: string | null;
    refundedAt: Date;
    refundedBy: string | null;
    refundSettlementStatus: 'pending' | 'settled';
    note: string | null;
  }>,
): Promise<void> {
  const patch = definedValues(values);
  if (Object.keys(patch).length === 0) return;
  await tx.update(customerPackages).set(patch).where(eq(customerPackages.id, id));
}

export function listPackagesOrderKey(row: CustomerPackageRow): { sortKey: string; id: string } {
  return { sortKey: row.soldAt.toISOString(), id: row.id };
}

export function ledgerOrderKey(row: PackageLedgerRow): { sortKey: string; id: string } {
  return { sortKey: row.createdAt.toISOString(), id: row.id };
}

/** Ham satır → model. Tarihler metin gelir, Date'e çevrilmeleri ŞART. */
function hydratePackage(row: Record<string, unknown>): CustomerPackageRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    customerId: row.customer_id as string,
    branchId: row.branch_id as string,
    definitionId: (row.definition_id ?? null) as string | null,
    definitionName: row.definition_name as string,
    definitionRevision: Number(row.definition_revision),
    totalPriceMinor: Number(row.total_price_minor),
    currency: row.currency as string,
    isTransferable: row.is_transferable as boolean,
    validityDays: row.validity_days == null ? null : Number(row.validity_days),
    soldAt: new Date(row.sold_at as string),
    expiresAt: row.expires_at == null ? null : new Date(row.expires_at as string),
    status: row.status as CustomerPackageStatus,
    remainingSessions: Number(row.remaining_sessions),
    refundedSessions: Number(row.refunded_sessions),
    refundAmountMinor: Number(row.refund_amount_minor),
    refundReason: (row.refund_reason ?? null) as string | null,
    refundedAt: row.refunded_at == null ? null : new Date(row.refunded_at as string),
    refundedBy: (row.refunded_by ?? null) as string | null,
    refundSettlementStatus: (row.refund_settlement_status ?? null) as
      | 'pending'
      | 'settled'
      | null,
    transferredFromPackageId: (row.transferred_from_package_id ?? null) as string | null,
    soldBy: (row.sold_by ?? null) as string | null,
    note: (row.note ?? null) as string | null,
    version: Number(row.version),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    deletedAt: row.deleted_at == null ? null : new Date(row.deleted_at as string),
  };
}
