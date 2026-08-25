import { and, eq, isNull } from 'drizzle-orm';
import { branches, tenants, tenantSettings } from '../../db/schema/index.js';
import type { Tx } from '../../db/tenant-tx.js';

/**
 * Kiracılık repository'si.
 *
 * KURAL: Bu dosyadaki her fonksiyon ilk parametre olarak `tx` alır ve global
 * `db` handle'ını ASLA kullanmaz. Sebep: kiracı context'i (`app.tenant_id`)
 * transaction'a bağlıdır; transaction dışında koşan bir sorgu RLS tarafından
 * boş küme görür veya — daha kötüsü — yanlış context'te çalışır.
 */

/**
 * `exactOptionalPropertyTypes` açıkken `Partial<T>` açıkça `undefined` atanan
 * alanları reddeder. Kısmi güncellemelerde (PATCH) gövdeden gelen alanlar tam
 * olarak böyle geldiği için, `undefined`a izin veren kendi tipimizi kullanıyoruz.
 */
type Updatable<T> = { [K in keyof T]?: T[K] | undefined };

export type TenantRow = typeof tenants.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;
export type TenantSettingsRow = typeof tenantSettings.$inferSelect;

export async function insertTenant(
  tx: Tx,
  values: { slug: string; name: string; timezone: string; currency: string },
): Promise<TenantRow> {
  const [row] = await tx.insert(tenants).values(values).returning();
  if (row === undefined) throw new Error('Kiracı oluşturulamadı');
  return row;
}

export async function insertDefaultSettings(tx: Tx, tenantId: string): Promise<void> {
  await tx.insert(tenantSettings).values({ tenantId, reminderHoursBefore: [24, 2] });
}

export async function findTenantById(tx: Tx, id: string): Promise<TenantRow | undefined> {
  const [row] = await tx
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
    .limit(1);
  return row;
}

export async function findTenantBySlug(tx: Tx, slug: string): Promise<TenantRow | undefined> {
  const [row] = await tx
    .select()
    .from(tenants)
    .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
    .limit(1);
  return row;
}

export async function updateTenant(
  tx: Tx,
  id: string,
  values: Updatable<Pick<TenantRow, 'name' | 'timezone' | 'status'>>,
): Promise<TenantRow | undefined> {
  const [row] = await tx.update(tenants).set(values).where(eq(tenants.id, id)).returning();
  return row;
}

export async function getSettings(
  tx: Tx,
  tenantId: string,
): Promise<TenantSettingsRow | undefined> {
  const [row] = await tx
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);
  return row;
}

export async function insertBranch(
  tx: Tx,
  values: {
    tenantId: string;
    slug: string;
    name: string;
    timezone: string;
    phone?: string | undefined;
    address?: string | undefined;
  },
): Promise<BranchRow> {
  const [row] = await tx.insert(branches).values(values).returning();
  if (row === undefined) throw new Error('Şube oluşturulamadı');
  return row;
}

export async function listBranches(tx: Tx): Promise<BranchRow[]> {
  // tenant_id filtresi YOK — RLS zaten kiracıyla sınırlıyor. Yine de
  // deleted_at filtresi uygulama kuralıdır.
  return tx.select().from(branches).where(isNull(branches.deletedAt)).orderBy(branches.name);
}

export async function findBranchById(tx: Tx, id: string): Promise<BranchRow | undefined> {
  const [row] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), isNull(branches.deletedAt)))
    .limit(1);
  return row;
}

export async function updateBranch(
  tx: Tx,
  id: string,
  values: Updatable<Pick<BranchRow, 'name' | 'timezone' | 'phone' | 'address' | 'isActive'>>,
): Promise<BranchRow | undefined> {
  const [row] = await tx.update(branches).set(values).where(eq(branches.id, id)).returning();
  return row;
}
