import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { branchServiceOverrides, serviceCategories, services } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import type { BranchServiceOverrideInputDto } from './dto/catalog.dto';

type Updatable<T> = { [K in keyof T]?: T[K] | undefined };

export type ServiceCategoryRow = typeof serviceCategories.$inferSelect;
export type ServiceRow = typeof services.$inferSelect;
export type BranchServiceOverrideRow = typeof branchServiceOverrides.$inferSelect;

export async function listServiceCategories(tx: Tx): Promise<ServiceCategoryRow[]> {
  return tx
    .select()
    .from(serviceCategories)
    .where(isNull(serviceCategories.deletedAt))
    .orderBy(serviceCategories.sortOrder, serviceCategories.name);
}

export async function findServiceCategoryById(
  tx: Tx,
  id: string,
): Promise<ServiceCategoryRow | undefined> {
  const [row] = await tx
    .select()
    .from(serviceCategories)
    .where(and(eq(serviceCategories.id, id), isNull(serviceCategories.deletedAt)))
    .limit(1);
  return row;
}

export async function insertServiceCategory(
  tx: Tx,
  values: {
    tenantId: string;
    slug: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
  },
): Promise<ServiceCategoryRow> {
  const [row] = await tx.insert(serviceCategories).values(values).returning();
  if (row === undefined) throw new Error('Hizmet kategorisi oluşturulamadı');
  return row;
}

export async function updateServiceCategory(
  tx: Tx,
  id: string,
  values: Updatable<Pick<ServiceCategoryRow, 'slug' | 'name' | 'sortOrder' | 'isActive'>>,
): Promise<ServiceCategoryRow | undefined> {
  if (Object.keys(values).length === 0) return findServiceCategoryById(tx, id);
  const [row] = await tx
    .update(serviceCategories)
    .set(values)
    .where(eq(serviceCategories.id, id))
    .returning();
  return row;
}

export async function countActiveServicesInCategory(tx: Tx, categoryId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(services)
    .where(
      and(
        eq(services.categoryId, categoryId),
        eq(services.isActive, true),
        isNull(services.deletedAt),
      ),
    );
  return row?.count ?? 0;
}

export async function listServices(tx: Tx): Promise<ServiceRow[]> {
  return tx
    .select()
    .from(services)
    .where(isNull(services.deletedAt))
    .orderBy(services.name);
}

export async function findServiceById(tx: Tx, id: string): Promise<ServiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(services)
    .where(and(eq(services.id, id), isNull(services.deletedAt)))
    .limit(1);
  return row;
}

export async function insertService(
  tx: Tx,
  values: {
    tenantId: string;
    categoryId: string;
    slug: string;
    name: string;
    description?: string | undefined;
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    priceMinor: number;
    vatRateBasisPoints: number;
    calendarColor?: string | undefined;
    isOnlineBookable: boolean;
    isActive: boolean;
  },
): Promise<ServiceRow> {
  const [row] = await tx.insert(services).values(values).returning();
  if (row === undefined) throw new Error('Hizmet oluşturulamadı');
  return row;
}

export async function updateService(
  tx: Tx,
  id: string,
  values: Updatable<
    Pick<
      ServiceRow,
      | 'categoryId'
      | 'slug'
      | 'name'
      | 'description'
      | 'durationMinutes'
      | 'bufferBeforeMinutes'
      | 'bufferAfterMinutes'
      | 'priceMinor'
      | 'vatRateBasisPoints'
      | 'calendarColor'
      | 'isOnlineBookable'
      | 'isActive'
    >
  >,
): Promise<ServiceRow | undefined> {
  if (Object.keys(values).length === 0) return findServiceById(tx, id);
  const [row] = await tx.update(services).set(values).where(eq(services.id, id)).returning();
  return row;
}

export async function listOverridesForService(
  tx: Tx,
  serviceId: string,
): Promise<BranchServiceOverrideRow[]> {
  return tx
    .select()
    .from(branchServiceOverrides)
    .where(
      and(
        eq(branchServiceOverrides.serviceId, serviceId),
        isNull(branchServiceOverrides.deletedAt),
      ),
    )
    .orderBy(branchServiceOverrides.createdAt);
}

export async function listOverridesForServices(
  tx: Tx,
  serviceIds: string[],
): Promise<BranchServiceOverrideRow[]> {
  if (serviceIds.length === 0) return [];
  return tx
    .select()
    .from(branchServiceOverrides)
    .where(
      and(
        inArray(branchServiceOverrides.serviceId, serviceIds),
        isNull(branchServiceOverrides.deletedAt),
      ),
    );
}

export async function replaceServiceOverrides(
  tx: Tx,
  tenantId: string,
  serviceId: string,
  overrides: BranchServiceOverrideInputDto[],
): Promise<void> {
  await tx.delete(branchServiceOverrides).where(eq(branchServiceOverrides.serviceId, serviceId));

  if (overrides.length === 0) return;

  await tx.insert(branchServiceOverrides).values(
    overrides.map((override) => ({
      tenantId,
      serviceId,
      branchId: override.branchId,
      durationMinutes: override.durationMinutes,
      bufferBeforeMinutes: override.bufferBeforeMinutes,
      bufferAfterMinutes: override.bufferAfterMinutes,
      priceMinor: override.priceMinor,
      vatRateBasisPoints: override.vatRateBasisPoints,
      isOnlineBookable: override.isOnlineBookable,
      isActive: override.isActive,
    })),
  );
}
