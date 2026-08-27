import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  customerFileGroups,
  customerFiles,
  customerRecordAccessLog,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type CustomerFileRow = typeof customerFiles.$inferSelect;
export type CustomerFileGroupRow = typeof customerFileGroups.$inferSelect;

export async function listFiles(tx: Tx, customerId: string): Promise<CustomerFileRow[]> {
  return tx
    .select()
    .from(customerFiles)
    .where(and(eq(customerFiles.customerId, customerId), isNull(customerFiles.deletedAt)))
    .orderBy(desc(customerFiles.createdAt), desc(customerFiles.id));
}

export async function findFileById(tx: Tx, id: string): Promise<CustomerFileRow | undefined> {
  const [row] = await tx
    .select()
    .from(customerFiles)
    .where(and(eq(customerFiles.id, id), isNull(customerFiles.deletedAt)))
    .limit(1);
  return row;
}

export async function findFileByStorageKey(
  tx: Tx,
  storageKey: string,
): Promise<CustomerFileRow | undefined> {
  const [row] = await tx
    .select()
    .from(customerFiles)
    .where(eq(customerFiles.storageKey, storageKey))
    .limit(1);
  return row;
}

export async function insertFile(
  tx: Tx,
  values: typeof customerFiles.$inferInsert,
): Promise<CustomerFileRow> {
  const [row] = await tx.insert(customerFiles).values(values).returning();
  if (row === undefined) throw new Error('Dosya kaydı oluşturulamadı');
  return row;
}

export async function setThumbnailKey(tx: Tx, id: string, key: string): Promise<void> {
  await tx.update(customerFiles).set({ thumbnailKey: key }).where(eq(customerFiles.id, id));
}

export async function softDeleteFile(tx: Tx, id: string): Promise<CustomerFileRow | undefined> {
  const [row] = await tx
    .update(customerFiles)
    .set({ deletedAt: new Date() })
    .where(and(eq(customerFiles.id, id), isNull(customerFiles.deletedAt)))
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Gruplar
// ---------------------------------------------------------------------------

export async function listGroups(tx: Tx, customerId: string): Promise<CustomerFileGroupRow[]> {
  return tx
    .select()
    .from(customerFileGroups)
    .where(eq(customerFileGroups.customerId, customerId))
    .orderBy(desc(customerFileGroups.createdAt));
}

export async function insertGroup(
  tx: Tx,
  values: typeof customerFileGroups.$inferInsert,
): Promise<CustomerFileGroupRow> {
  const [row] = await tx.insert(customerFileGroups).values(values).returning();
  if (row === undefined) throw new Error('Dosya grubu oluşturulamadı');
  return row;
}

/** Gruplara ait dosyaları TEK sorguda okur (N+1 yok). */
export async function listFilesForGroups(
  tx: Tx,
  groupIds: string[],
): Promise<Map<string, CustomerFileRow[]>> {
  const grouped = new Map<string, CustomerFileRow[]>();
  if (groupIds.length === 0) return grouped;

  const rows = await tx
    .select()
    .from(customerFiles)
    .where(and(inArray(customerFiles.groupId, groupIds), isNull(customerFiles.deletedAt)))
    .orderBy(customerFiles.position, customerFiles.createdAt);

  for (const row of rows) {
    if (row.groupId === null) continue;
    const list = grouped.get(row.groupId) ?? [];
    list.push(row);
    grouped.set(row.groupId, list);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Erişim kaydı
// ---------------------------------------------------------------------------

/**
 * KVKK m.6 erişim kaydı. Her görüntüleme/indirme İÇİN yazılır — "nice to have"
 * değil, yükümlülük (bkz. bölüm 4.5).
 */
export async function insertAccessLog(
  tx: Tx,
  values: typeof customerRecordAccessLog.$inferInsert,
): Promise<void> {
  await tx.insert(customerRecordAccessLog).values(values);
}

export async function listAccessLog(
  tx: Tx,
  customerId: string,
  limit: number,
): Promise<(typeof customerRecordAccessLog.$inferSelect)[]> {
  return tx
    .select()
    .from(customerRecordAccessLog)
    .where(eq(customerRecordAccessLog.customerId, customerId))
    .orderBy(desc(customerRecordAccessLog.createdAt))
    .limit(limit);
}
