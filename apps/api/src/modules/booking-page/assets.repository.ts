import { and, eq, isNull, sql } from 'drizzle-orm';
import { tenantAssets, type TenantAssetPurpose } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type TenantAssetRow = typeof tenantAssets.$inferSelect;

export async function listAssets(
  tx: Tx,
  purpose: TenantAssetPurpose | undefined,
): Promise<TenantAssetRow[]> {
  const conditions = [isNull(tenantAssets.deletedAt)];
  if (purpose !== undefined) conditions.push(eq(tenantAssets.purpose, purpose));
  return tx
    .select()
    .from(tenantAssets)
    .where(and(...conditions))
    .orderBy(sql`created_at desc`);
}

export async function findAsset(tx: Tx, id: string): Promise<TenantAssetRow | undefined> {
  const [row] = await tx
    .select()
    .from(tenantAssets)
    .where(and(eq(tenantAssets.id, id), isNull(tenantAssets.deletedAt)))
    .limit(1);
  return row;
}

export async function findByStorageKey(
  tx: Tx,
  storageKey: string,
): Promise<TenantAssetRow | undefined> {
  const [row] = await tx
    .select()
    .from(tenantAssets)
    .where(eq(tenantAssets.storageKey, storageKey))
    .limit(1);
  return row;
}

export async function insertAsset(
  tx: Tx,
  values: typeof tenantAssets.$inferInsert,
): Promise<TenantAssetRow> {
  const [row] = await tx.insert(tenantAssets).values(values).returning();
  if (row === undefined) throw new Error('Görsel kaydı yazılamadı');
  return row;
}

/** Yumuşak silme: içerik sürümleri değişmez ve eski bir sürüm bu kimliği anmaya devam eder. */
export async function softDeleteAsset(tx: Tx, id: string): Promise<void> {
  await tx
    .update(tenantAssets)
    .set({ deletedAt: new Date() })
    .where(eq(tenantAssets.id, id));
}
