import { and, desc, eq, isNull } from 'drizzle-orm';
import { customers } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, hasUpdates, type Updatable } from '../../database/updates';

export type CustomerRow = typeof customers.$inferSelect;

export async function listCustomers(tx: Tx): Promise<CustomerRow[]> {
  return tx
    .select()
    .from(customers)
    .where(isNull(customers.deletedAt))
    .orderBy(desc(customers.createdAt));
}

export async function findCustomerById(tx: Tx, id: string): Promise<CustomerRow | undefined> {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1);
  return row;
}

export async function insertCustomer(
  tx: Tx,
  values: {
    tenantId: string;
    fullName: string;
    phone?: string | null | undefined;
    email?: string | null | undefined;
    birthDate?: string | null | undefined;
    gender?: CustomerRow['gender'] | undefined;
    notes?: string | null | undefined;
  },
): Promise<CustomerRow> {
  const [row] = await tx.insert(customers).values(values).returning();
  if (row === undefined) throw new Error('Müşteri oluşturulamadı');
  return row;
}

export async function updateCustomer(
  tx: Tx,
  id: string,
  values: Updatable<
    Pick<CustomerRow, 'fullName' | 'phone' | 'email' | 'birthDate' | 'gender' | 'notes'>
  >,
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
