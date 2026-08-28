import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { packageDefinitionItems, packageDefinitions, services } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, type Updatable } from '../../database/updates';

export type PackageDefinitionRow = typeof packageDefinitions.$inferSelect;

/** Kalem satırı + gösterim için hizmetin GÜNCEL katalog verisi. */
export interface PackageDefinitionItemRow {
  id: string;
  definitionId: string;
  serviceId: string;
  serviceName: string;
  quantity: number;
  unitListPriceMinor: number;
  sortOrder: number;
}

interface ListFilters {
  limit: number;
  cursorCreatedAt?: string | undefined;
  cursorId?: string | undefined;
  branchId?: string | undefined;
  serviceId?: string | undefined;
  isActive?: boolean | undefined;
}

export async function listDefinitions(
  tx: Tx,
  filters: ListFilters,
): Promise<PackageDefinitionRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select d.*
      from package_definitions d
     where d.deleted_at is null
       -- Şube filtresi paketi DIŞLAMAZ, kapsamı sorar: şube kısıtı olmayan
       -- paket her şubede satılabilir, dolayısıyla her şube filtresine girer.
       and (${filters.branchId ?? null}::uuid is null
            or d.branch_id is null
            or d.branch_id = ${filters.branchId ?? null}::uuid)
       and (${filters.serviceId ?? null}::uuid is null or exists (
             select 1 from package_definition_items i
              where i.definition_id = d.id
                and i.service_id = ${filters.serviceId ?? null}::uuid))
       and (${filters.isActive ?? null}::boolean is null
            or d.is_active = ${filters.isActive ?? null}::boolean)
       and (${filters.cursorCreatedAt ?? null}::timestamptz is null
            or (d.created_at, d.id)
               < (${filters.cursorCreatedAt ?? null}::timestamptz, ${filters.cursorId ?? null}::uuid))
     order by d.created_at desc, d.id desc
     limit ${filters.limit}
  `);
  return result.rows.map(hydrate);
}

export async function findDefinitionById(
  tx: Tx,
  id: string,
): Promise<PackageDefinitionRow | undefined> {
  const [row] = await tx
    .select()
    .from(packageDefinitions)
    .where(and(eq(packageDefinitions.id, id), isNull(packageDefinitions.deletedAt)));
  return row;
}

/**
 * Birden çok tanımın kalemleri tek sorguda — liste ucunda N+1 olmasın.
 *
 * Hizmet adı ve fiyatı buradan GÜNCEL katalogdan okunur; tanım bir şablondur,
 * snapshot satışta alınır (0024).
 */
export async function listItemsForDefinitions(
  tx: Tx,
  definitionIds: string[],
): Promise<Map<string, PackageDefinitionItemRow[]>> {
  const byDefinition = new Map<string, PackageDefinitionItemRow[]>();
  if (definitionIds.length === 0) return byDefinition;

  const rows = await tx
    .select({
      id: packageDefinitionItems.id,
      definitionId: packageDefinitionItems.definitionId,
      serviceId: packageDefinitionItems.serviceId,
      quantity: packageDefinitionItems.quantity,
      sortOrder: packageDefinitionItems.sortOrder,
      serviceName: services.name,
      unitListPriceMinor: services.priceMinor,
    })
    .from(packageDefinitionItems)
    .innerJoin(services, eq(services.id, packageDefinitionItems.serviceId))
    .where(inArray(packageDefinitionItems.definitionId, definitionIds))
    .orderBy(packageDefinitionItems.sortOrder, packageDefinitionItems.id);

  for (const row of rows) {
    const bucket = byDefinition.get(row.definitionId);
    if (bucket === undefined) byDefinition.set(row.definitionId, [row]);
    else bucket.push(row);
  }
  return byDefinition;
}

export async function insertDefinition(
  tx: Tx,
  values: typeof packageDefinitions.$inferInsert,
): Promise<PackageDefinitionRow> {
  const [row] = await tx.insert(packageDefinitions).values(values).returning();
  if (row === undefined) throw new Error('Paket tanımı yazılamadı');
  return row;
}

export async function replaceItems(
  tx: Tx,
  params: {
    tenantId: string;
    definitionId: string;
    items: { serviceId: string; quantity: number }[];
  },
): Promise<void> {
  await tx
    .delete(packageDefinitionItems)
    .where(eq(packageDefinitionItems.definitionId, params.definitionId));
  if (params.items.length === 0) return;

  await tx.insert(packageDefinitionItems).values(
    params.items.map((item, index) => ({
      tenantId: params.tenantId,
      definitionId: params.definitionId,
      serviceId: item.serviceId,
      quantity: item.quantity,
      sortOrder: index,
    })),
  );
}

/**
 * `where version = $expected` atomiktir — bkz. `appointments.repository`.
 * Sayacı trigger artırır; burada yalnız beklenen değer okunur.
 */
export async function updateWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  values: Updatable<{
    name: string;
    description: string | null;
    totalPriceMinor: number;
    validityDays: number | null;
    isTransferable: boolean;
    isOnlineSellable: boolean;
    isActive: boolean;
    deletedAt: Date;
  }>,
): Promise<PackageDefinitionRow | undefined> {
  const [row] = await tx
    .update(packageDefinitions)
    // Kalem değişikliği tek başına gelse bile satırın sürümü artmalı:
    // `updated_at`e dokunmak trigger'ı tetiklemek için yeterli.
    .set({ ...definedValues(values), updatedAt: new Date() })
    .where(
      and(
        eq(packageDefinitions.id, id),
        eq(packageDefinitions.version, expectedVersion),
        isNull(packageDefinitions.deletedAt),
      ),
    )
    .returning();
  return row;
}

/** Bu tanımdan hiç satış yapıldı mı — emekliye ayırma bunu sorar. */
export async function hasSales(tx: Tx, definitionId: string): Promise<boolean> {
  const result = await tx.execute<{ exists: boolean }>(sql`
    select exists (
      select 1 from customer_packages where definition_id = ${definitionId}::uuid
    ) as exists
  `);
  return result.rows[0]?.exists === true;
}

export function listDefinitionsOrderKey(row: PackageDefinitionRow): {
  sortKey: string;
  id: string;
} {
  return { sortKey: row.createdAt.toISOString(), id: row.id };
}

/**
 * Drizzle `execute` HAM satır döndürür: kolon adları snake_case, timestamp'ler
 * metin. Tarihleri burada Date'e çevirmek şart — `select()` builder'ıyla gelen
 * satır Date taşır, bu yol taşımaz ve iki yol aynı tipte olmalıdır.
 */
function hydrate(row: Record<string, unknown>): PackageDefinitionRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    branchId: row.branch_id as string | null,
    slug: row.slug as string,
    name: row.name as string,
    description: row.description as string | null,
    totalPriceMinor: Number(row.total_price_minor),
    currency: row.currency as string,
    validityDays: row.validity_days === null ? null : Number(row.validity_days),
    isTransferable: row.is_transferable as boolean,
    isOnlineSellable: row.is_online_sellable as boolean,
    isActive: row.is_active as boolean,
    revision: Number(row.revision),
    version: Number(row.version),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    deletedAt: row.deleted_at == null ? null : new Date(row.deleted_at as string),
  };
}
