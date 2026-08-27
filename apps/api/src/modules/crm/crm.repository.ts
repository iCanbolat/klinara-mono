import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  customerMerges,
  customerTagAssignments,
  customerTags,
  customers,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, hasUpdates, type Updatable } from '../../database/updates';

export type CustomerRow = typeof customers.$inferSelect;
export type CustomerTagRow = typeof customerTags.$inferSelect;
export type CustomerMergeRow = typeof customerMerges.$inferSelect;

/**
 * Müşteriye AİT satırları taşıyan tablolar — birleştirmenin tek kaynağı.
 *
 * Sonraki batch'ler (notlar, dosyalar, paketler, tahsilat, onam) buraya satır
 * ekler. Listeyi tek yerde tutmanın sebebi: taşınmayı unutulan bir tablo,
 * birleştirmeden sonra hiçbir müşteri kartında görünmeyen YETİM kayıt demek.
 *
 * `customer_tag_assignments` burada YOK: composite PK'sı yüzünden çakışma
 * ihtimali var, ayrıca ele alınıyor.
 */
const CUSTOMER_OWNED_TABLES = ['appointments', 'customer_bookings'] as const;

interface ListFilters {
  limit: number;
  cursorCreatedAt?: string | undefined;
  cursorId?: string | undefined;
  tagId?: string | undefined;
  source?: string | undefined;
}

export async function listCustomers(tx: Tx, filters: ListFilters): Promise<CustomerRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select c.*
      from customers c
     where c.deleted_at is null
       and (${filters.tagId ?? null}::uuid is null or exists (
             select 1 from customer_tag_assignments a
              where a.customer_id = c.id and a.tag_id = ${filters.tagId ?? null}::uuid))
       and (${filters.source ?? null}::text is null or c.source = ${filters.source ?? null}::text)
       -- Keyset: sıralama anahtarı (created_at) TEKİL DEĞİL; aynı saniyede
       -- açılan iki kayıt yalnız zamanla ilerleyen bir cursor'da birbirini
       -- gizlerdi.
       and (${filters.cursorCreatedAt ?? null}::timestamptz is null
            or (c.created_at, c.id)
               < (${filters.cursorCreatedAt ?? null}::timestamptz, ${filters.cursorId ?? null}::uuid))
     order by c.created_at desc, c.id desc
     limit ${filters.limit}
  `);
  return result.rows.map(hydrate);
}

export async function searchCustomers(
  tx: Tx,
  filters: { folded: string; limit: number },
): Promise<CustomerRow[]> {
  // `like '%…%'` ve `similarity` aynı gin_trgm_ops indeksinden besleniyor:
  // eşleşmeyi LIKE yapıyor (ad parçası VE telefon parçası), sıralamayı
  // benzerlik. Ayrı bir telefon indeksine gerek kalmıyor.
  const result = await tx.execute<Record<string, unknown>>(sql`
    select c.*
      from customers c
     where c.deleted_at is null
       and c.search_text like '%' || ${filters.folded}::text || '%'
     order by similarity(c.search_text, ${filters.folded}::text) desc,
              c.full_name,
              c.id
     limit ${filters.limit}
  `);
  return result.rows.map(hydrate);
}

/** Drizzle `execute` ham satır döndürür; kolon adlarını modele çeviriyoruz. */
function hydrate(row: Record<string, unknown>): CustomerRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    fullName: row.full_name as string,
    phone: (row.phone ?? null) as string | null,
    email: (row.email ?? null) as string | null,
    birthDate: (row.birth_date ?? null) as string | null,
    gender: (row.gender ?? null) as CustomerRow['gender'],
    notes: (row.notes ?? null) as string | null,
    addressLine: (row.address_line ?? null) as string | null,
    district: (row.district ?? null) as string | null,
    city: (row.city ?? null) as string | null,
    postalCode: (row.postal_code ?? null) as string | null,
    source: (row.source ?? null) as CustomerRow['source'],
    mergedIntoCustomerId: (row.merged_into_customer_id ?? null) as string | null,
    searchText: (row.search_text ?? null) as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    deletedAt: row.deleted_at == null ? null : new Date(row.deleted_at as string),
  };
}

export async function findCustomerById(tx: Tx, id: string): Promise<CustomerRow | undefined> {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1);
  return row;
}

/** Arşivlenmiş kayıtları da bulur — birleştirme kaynağı için gerekli. */
export async function findAnyCustomerById(tx: Tx, id: string): Promise<CustomerRow | undefined> {
  const [row] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
  return row;
}

type CustomerWritableFields = Pick<
  CustomerRow,
  | 'fullName'
  | 'phone'
  | 'email'
  | 'birthDate'
  | 'gender'
  | 'notes'
  | 'addressLine'
  | 'district'
  | 'city'
  | 'postalCode'
  | 'source'
>;

export async function insertCustomer(
  tx: Tx,
  values: { tenantId: string } & Updatable<CustomerWritableFields> & { fullName: string },
): Promise<CustomerRow> {
  const [row] = await tx.insert(customers).values(values).returning();
  if (row === undefined) throw new Error('Müşteri oluşturulamadı');
  return row;
}

export async function updateCustomer(
  tx: Tx,
  id: string,
  values: Updatable<CustomerWritableFields>,
): Promise<CustomerRow | undefined> {
  const patch = definedValues(values);
  if (!hasUpdates(patch)) return findCustomerById(tx, id);

  const [row] = await tx
    .update(customers)
    .set(patch)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .returning();
  return row;
}

/**
 * Soft delete. İş kayıtlarında satır SİLİNMEZ: müşterinin geçmiş randevuları,
 * tahsilatları ve onam kayıtları ona bağlıdır ve saklanma yükümlülüğü vardır.
 */
export async function softDeleteCustomer(tx: Tx, id: string): Promise<CustomerRow | undefined> {
  const [row] = await tx
    .update(customers)
    .set({ deletedAt: new Date() })
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Etiketler
// ---------------------------------------------------------------------------

export async function listTags(tx: Tx): Promise<CustomerTagRow[]> {
  return tx.select().from(customerTags).orderBy(customerTags.name);
}

export async function findTagById(tx: Tx, id: string): Promise<CustomerTagRow | undefined> {
  const [row] = await tx.select().from(customerTags).where(eq(customerTags.id, id)).limit(1);
  return row;
}

export async function insertTag(
  tx: Tx,
  values: { tenantId: string; name: string; color?: string | null | undefined },
): Promise<CustomerTagRow> {
  const [row] = await tx.insert(customerTags).values(values).returning();
  if (row === undefined) throw new Error('Etiket oluşturulamadı');
  return row;
}

export async function updateTag(
  tx: Tx,
  id: string,
  values: Updatable<Pick<CustomerTagRow, 'name' | 'color'>>,
): Promise<CustomerTagRow | undefined> {
  const patch = definedValues(values);
  if (!hasUpdates(patch)) return findTagById(tx, id);
  const [row] = await tx
    .update(customerTags)
    .set(patch)
    .where(eq(customerTags.id, id))
    .returning();
  return row;
}

export async function deleteTag(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.delete(customerTags).where(eq(customerTags.id, id)).returning();
  return rows.length > 0;
}

/**
 * Birden çok müşterinin etiketlerini TEK sorguda okur.
 *
 * Liste ucunun N+1'e düşmemesinin tek sebebi bu: sayfa başına iki sorgu
 * (müşteriler + etiketleri), müşteri sayısından bağımsız.
 */
export async function listTagsForCustomers(
  tx: Tx,
  customerIds: string[],
): Promise<Map<string, CustomerTagRow[]>> {
  const grouped = new Map<string, CustomerTagRow[]>();
  if (customerIds.length === 0) return grouped;

  const rows = await tx
    .select({ customerId: customerTagAssignments.customerId, tag: customerTags })
    .from(customerTagAssignments)
    .innerJoin(customerTags, eq(customerTags.id, customerTagAssignments.tagId))
    .where(inArray(customerTagAssignments.customerId, customerIds))
    .orderBy(customerTags.name);

  for (const row of rows) {
    const list = grouped.get(row.customerId) ?? [];
    list.push(row.tag);
    grouped.set(row.customerId, list);
  }
  return grouped;
}

export async function replaceCustomerTags(
  tx: Tx,
  tenantId: string,
  customerId: string,
  tagIds: string[],
): Promise<void> {
  await tx.delete(customerTagAssignments).where(eq(customerTagAssignments.customerId, customerId));
  if (tagIds.length === 0) return;
  await tx
    .insert(customerTagAssignments)
    .values(tagIds.map((tagId) => ({ tenantId, customerId, tagId })));
}

// ---------------------------------------------------------------------------
// Birleştirme
// ---------------------------------------------------------------------------

/**
 * Kaynağın tüm satırlarını hedefe taşır ve tablo başına sayıyı döndürür.
 *
 * Tablo adları SABİT bir listeden gelir (kullanıcı girdisi değil), bu yüzden
 * `sql.raw` güvenli.
 */
export async function moveCustomerRows(
  tx: Tx,
  sourceId: string,
  targetId: string,
): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};

  for (const table of CUSTOMER_OWNED_TABLES) {
    const result = await tx.execute<{ id: string }>(sql`
      update ${sql.raw(table)}
         set customer_id = ${targetId}::uuid
       where customer_id = ${sourceId}::uuid
      returning id
    `);
    moved[table] = result.rows.length;
  }

  // Etiketler: hedefte zaten varsa çakışır, o yüzden ayrı ele alınıyor.
  const tagResult = await tx.execute<{ tag_id: string }>(sql`
    update customer_tag_assignments
       set customer_id = ${targetId}::uuid
     where customer_id = ${sourceId}::uuid
       and tag_id not in (
         select tag_id from customer_tag_assignments where customer_id = ${targetId}::uuid
       )
    returning tag_id
  `);
  moved.customer_tag_assignments = tagResult.rows.length;

  return moved;
}

export async function insertMerge(
  tx: Tx,
  values: {
    tenantId: string;
    sourceCustomerId: string;
    targetCustomerId: string;
    actorUserId: string | null;
    moved: Record<string, number>;
  },
): Promise<CustomerMergeRow> {
  const [row] = await tx.insert(customerMerges).values(values).returning();
  if (row === undefined) throw new Error('Birleştirme kaydı yazılamadı');
  return row;
}

export async function archiveMergedCustomer(
  tx: Tx,
  sourceId: string,
  targetId: string,
): Promise<void> {
  await tx
    .update(customers)
    .set({ deletedAt: new Date(), mergedIntoCustomerId: targetId })
    .where(eq(customers.id, sourceId));
}

export function listCustomersOrderKey(row: CustomerRow): { sortKey: string; id: string } {
  return { sortKey: row.createdAt.toISOString(), id: row.id };
}
