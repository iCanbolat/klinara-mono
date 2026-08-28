import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  charges,
  discounts,
  paymentAllocations,
  payments,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, type Updatable } from '../../database/updates';

export type ChargeRow = typeof charges.$inferSelect;
export type DiscountRow = typeof discounts.$inferSelect;

// ---------------------------------------------------------------------------
// Ücret kalemleri
// ---------------------------------------------------------------------------

export async function insertCharge(
  tx: Tx,
  values: typeof charges.$inferInsert,
): Promise<ChargeRow> {
  const [row] = await tx.insert(charges).values(values).returning();
  if (row === undefined) throw new Error('Ücret kalemi yazılamadı');
  return row;
}

export async function findChargeById(tx: Tx, id: string): Promise<ChargeRow | undefined> {
  const [row] = await tx.select().from(charges).where(eq(charges.id, id));
  return row;
}

/** Yazma yolunda satırı KİLİTLİ okur — sürüm kontrolünden önce. */
export async function lockChargeById(tx: Tx, id: string): Promise<ChargeRow | undefined> {
  const [row] = await tx.select().from(charges).where(eq(charges.id, id)).for('update');
  return row;
}

export async function updateChargeWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  values: Updatable<typeof charges.$inferInsert>,
): Promise<ChargeRow | undefined> {
  const [row] = await tx
    .update(charges)
    .set(definedValues(values))
    .where(and(eq(charges.id, id), eq(charges.version, expectedVersion)))
    .returning();
  return row;
}

export interface ChargeFilters {
  customerId?: string | undefined;
  branchId?: string | undefined;
  source?: string | undefined;
  status?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  appointmentServiceId?: string | undefined;
}

export async function listCharges(
  tx: Tx,
  filters: ChargeFilters,
  page: { limit: number; cursor?: { sortKey: string; id: string } | undefined },
): Promise<ChargeRow[]> {
  const conditions: SQL[] = [];
  if (filters.customerId !== undefined) conditions.push(eq(charges.customerId, filters.customerId));
  if (filters.branchId !== undefined) conditions.push(eq(charges.branchId, filters.branchId));
  if (filters.source !== undefined) conditions.push(sql`${charges.source} = ${filters.source}`);
  if (filters.status !== undefined) conditions.push(sql`${charges.status} = ${filters.status}`);
  if (filters.from !== undefined) conditions.push(gte(charges.createdAt, filters.from));
  if (filters.to !== undefined) conditions.push(lt(charges.createdAt, filters.to));
  if (filters.appointmentServiceId !== undefined) {
    conditions.push(eq(charges.appointmentServiceId, filters.appointmentServiceId));
  }

  // Cursor `(created_at, id)` çiftini taşır — `created_at` tekil değil.
  if (page.cursor !== undefined) {
    const at = new Date(page.cursor.sortKey);
    const id = page.cursor.id;
    const step = or(
      lt(charges.createdAt, at),
      and(eq(charges.createdAt, at), lt(charges.id, id)),
    );
    if (step !== undefined) conditions.push(step);
  }

  return tx
    .select()
    .from(charges)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(charges.createdAt), desc(charges.id))
    .limit(page.limit + 1);
}

/**
 * Randevunun paketten KARŞILANMAYAN kalemleri.
 *
 * Paketten düşülen kalem için borç yazılmaz: o borç paket satıldığında zaten
 * doğdu (bkz. `0027` başlığı). `customer_package_item_id` dolu olan satırlar
 * bu yüzden dışarıda kalır.
 */
export async function listBillableAppointmentServices(
  tx: Tx,
  appointmentId: string,
): Promise<
  {
    appointmentServiceId: string;
    serviceName: string;
    priceMinor: number;
    vatRateBasisPoints: number;
    branchId: string;
    customerId: string;
  }[]
> {
  const result = await tx.execute<{
    appointment_service_id: string;
    service_name: string;
    price_minor: string | number;
    vat_rate_basis_points: number;
    branch_id: string;
    customer_id: string;
  }>(sql`
    select s.id            as appointment_service_id,
           sv.name         as service_name,
           s.price_minor,
           s.vat_rate_basis_points,
           a.branch_id,
           a.customer_id
      from appointment_services s
      join appointments a on a.id = s.appointment_id
      join services sv    on sv.id = s.service_id
     where s.appointment_id = ${appointmentId}::uuid
       and s.customer_package_item_id is null
     order by s.sort_order, s.id
  `);

  return result.rows.map((row) => ({
    appointmentServiceId: row.appointment_service_id,
    serviceName: row.service_name,
    priceMinor: Number(row.price_minor),
    vatRateBasisPoints: row.vat_rate_basis_points,
    branchId: row.branch_id,
    customerId: row.customer_id,
  }));
}

/** Randevuya bağlı AÇIK ücret kalemleri — geri alma yolunda `void` edilir. */
export async function listOpenChargesForAppointment(
  tx: Tx,
  appointmentId: string,
): Promise<ChargeRow[]> {
  const result = await tx.execute<{ id: string }>(sql`
    select c.id
      from charges c
      join appointment_services s on s.id = c.appointment_service_id
     where s.appointment_id = ${appointmentId}::uuid
       and c.status = 'open'
     for update of c
  `);
  if (result.rows.length === 0) return [];

  return tx
    .select()
    .from(charges)
    .where(inArray(charges.id, result.rows.map((row) => row.id)));
}

// ---------------------------------------------------------------------------
// İndirimler
// ---------------------------------------------------------------------------

export async function insertDiscount(
  tx: Tx,
  values: typeof discounts.$inferInsert,
): Promise<DiscountRow> {
  const [row] = await tx.insert(discounts).values(values).returning();
  if (row === undefined) throw new Error('İndirim yazılamadı');
  return row;
}

export async function findDiscountById(
  tx: Tx,
  id: string,
): Promise<DiscountRow | undefined> {
  const [row] = await tx
    .select()
    .from(discounts)
    .where(and(eq(discounts.id, id), isNull(discounts.deletedAt)));
  return row;
}

export async function updateDiscountWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  values: Updatable<typeof discounts.$inferInsert>,
): Promise<DiscountRow | undefined> {
  const [row] = await tx
    .update(discounts)
    .set(definedValues(values))
    .where(
      and(
        eq(discounts.id, id),
        eq(discounts.version, expectedVersion),
        isNull(discounts.deletedAt),
      ),
    )
    .returning();
  return row;
}

export async function listDiscounts(
  tx: Tx,
  filters: { activeOnly?: boolean | undefined },
  page: { limit: number; cursor?: { sortKey: string; id: string } | undefined },
): Promise<DiscountRow[]> {
  const conditions: SQL[] = [isNull(discounts.deletedAt)];

  if (filters.activeOnly === true) {
    conditions.push(eq(discounts.isActive, true));
    const started = or(isNull(discounts.startsAt), lte(discounts.startsAt, new Date()));
    const notEnded = or(isNull(discounts.endsAt), sql`${discounts.endsAt} > now()`);
    if (started !== undefined) conditions.push(started);
    if (notEnded !== undefined) conditions.push(notEnded);
  }

  if (page.cursor !== undefined) {
    const at = new Date(page.cursor.sortKey);
    const id = page.cursor.id;
    const step = or(
      lt(discounts.createdAt, at),
      and(eq(discounts.createdAt, at), lt(discounts.id, id)),
    );
    if (step !== undefined) conditions.push(step);
  }

  return tx
    .select()
    .from(discounts)
    .where(and(...conditions))
    .orderBy(desc(discounts.createdAt), desc(discounts.id))
    .limit(page.limit + 1);
}

// ---------------------------------------------------------------------------
// Tahsilat
// ---------------------------------------------------------------------------

export type PaymentRow = typeof payments.$inferSelect;
export type PaymentAllocationRow = typeof paymentAllocations.$inferSelect;

/**
 * Makbuz numarasını üretir — BOŞLUKSUZ.
 *
 * Sayaç `next_receipt_no()` içinde transaction'a bağlı bir advisory lock
 * altında okunup artırılır; sequence kullanılmaz çünkü sequence rollback'te
 * boşluk bırakır (bkz. `0028`).
 */
export async function nextReceiptNo(tx: Tx, tenantId: string): Promise<number> {
  const result = await tx.execute<{ next_receipt_no: string | number }>(
    sql`select next_receipt_no(${tenantId}::uuid) as next_receipt_no`,
  );
  const value = result.rows[0]?.next_receipt_no;
  if (value === undefined) throw new Error('Makbuz numarası üretilemedi');
  return Number(value);
}

export async function insertPayment(
  tx: Tx,
  values: typeof payments.$inferInsert,
): Promise<PaymentRow> {
  const [row] = await tx.insert(payments).values(values).returning();
  if (row === undefined) throw new Error('Tahsilat yazılamadı');
  return row;
}

export async function insertAllocations(
  tx: Tx,
  values: (typeof paymentAllocations.$inferInsert)[],
): Promise<PaymentAllocationRow[]> {
  if (values.length === 0) return [];
  return tx.insert(paymentAllocations).values(values).returning();
}

export async function findPaymentById(tx: Tx, id: string): Promise<PaymentRow | undefined> {
  const [row] = await tx.select().from(payments).where(eq(payments.id, id));
  return row;
}

export async function lockPaymentById(tx: Tx, id: string): Promise<PaymentRow | undefined> {
  const [row] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
  return row;
}

export async function updatePaymentWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  values: Updatable<typeof payments.$inferInsert>,
): Promise<PaymentRow | undefined> {
  const [row] = await tx
    .update(payments)
    .set(definedValues(values))
    .where(and(eq(payments.id, id), eq(payments.version, expectedVersion)))
    .returning();
  return row;
}

export interface PaymentFilters {
  customerId?: string | undefined;
  branchId?: string | undefined;
  method?: string | undefined;
  status?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export async function listPayments(
  tx: Tx,
  filters: PaymentFilters,
  page: { limit: number; cursor?: { sortKey: string; id: string } | undefined },
): Promise<PaymentRow[]> {
  const conditions: SQL[] = [];
  if (filters.customerId !== undefined) {
    conditions.push(eq(payments.customerId, filters.customerId));
  }
  if (filters.branchId !== undefined) conditions.push(eq(payments.branchId, filters.branchId));
  if (filters.method !== undefined) conditions.push(sql`${payments.method} = ${filters.method}`);
  if (filters.status !== undefined) conditions.push(sql`${payments.status} = ${filters.status}`);
  if (filters.from !== undefined) conditions.push(gte(payments.paidAt, filters.from));
  if (filters.to !== undefined) conditions.push(lt(payments.paidAt, filters.to));

  if (page.cursor !== undefined) {
    const at = new Date(page.cursor.sortKey);
    const id = page.cursor.id;
    const step = or(lt(payments.paidAt, at), and(eq(payments.paidAt, at), lt(payments.id, id)));
    if (step !== undefined) conditions.push(step);
  }

  return tx
    .select()
    .from(payments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(payments.paidAt), desc(payments.id))
    .limit(page.limit + 1);
}

export interface AllocationDetail {
  id: string;
  paymentId: string;
  chargeId: string;
  amountMinor: number;
  chargeDescription: string;
}

export async function listAllocationsForPayments(
  tx: Tx,
  paymentIds: string[],
): Promise<Map<string, AllocationDetail[]>> {
  const grouped = new Map<string, AllocationDetail[]>();
  if (paymentIds.length === 0) return grouped;

  const rows = await tx
    .select({
      id: paymentAllocations.id,
      paymentId: paymentAllocations.paymentId,
      chargeId: paymentAllocations.chargeId,
      amountMinor: paymentAllocations.amountMinor,
      chargeDescription: charges.description,
    })
    .from(paymentAllocations)
    .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
    .where(inArray(paymentAllocations.paymentId, paymentIds))
    // Sıra KALEMİN yaşına göre — tahsis satırlarının kendi `created_at`i
    // değil: `now()` transaction boyunca sabittir, tek bir insert'te yazılan
    // satırların hepsi aynı damgayı taşır ve sıra rastgele uuid'ye kalır
    // (gözlendi). Kalem yaşı hem deterministik hem de otomatik dağıtımın
    // izlediği sıranın aynısı.
    .orderBy(asc(charges.createdAt), asc(charges.id));

  for (const row of rows) {
    const list = grouped.get(row.paymentId) ?? [];
    list.push(row);
    grouped.set(row.paymentId, list);
  }
  return grouped;
}

export interface OutstandingCharge {
  chargeId: string;
  description: string;
  totalMinor: number;
  allocatedMinor: number;
  outstandingMinor: number;
}

/**
 * Müşterinin AÇIK bakiyesi olan kalemleri — eskiden yeniye.
 *
 * Otomatik dağıtımın sırası budur: en eski borç önce kapanır. İptal edilmiş
 * tahsilatların tahsisleri sayılmaz, yoksa iptal edilen bir ödeme borcu
 * kapalı göstermeye devam ederdi.
 */
export async function listOutstandingCharges(
  tx: Tx,
  customerId: string,
): Promise<OutstandingCharge[]> {
  const result = await tx.execute<{
    charge_id: string;
    description: string;
    total_minor: string | number;
    allocated_minor: string | number;
  }>(sql`
    select c.id as charge_id,
           c.description,
           c.total_minor,
           coalesce((
             select sum(a.amount_minor)
               from payment_allocations a
               join payments p on p.id = a.payment_id
              where a.charge_id = c.id and p.status = 'posted'
           ), 0) as allocated_minor
      from charges c
     where c.customer_id = ${customerId}::uuid
       and c.status = 'open'
       and c.total_minor > 0
     order by c.created_at, c.id
  `);

  return result.rows
    .map((row) => {
      const totalMinor = Number(row.total_minor);
      const allocatedMinor = Number(row.allocated_minor);
      return {
        chargeId: row.charge_id,
        description: row.description,
        totalMinor,
        allocatedMinor,
        outstandingMinor: totalMinor - allocatedMinor,
      };
    })
    .filter((row) => row.outstandingMinor > 0);
}

/** Bir tahsilata ait tahsislerin toplamı. */
export async function allocatedTotal(tx: Tx, paymentId: string): Promise<number> {
  const result = await tx.execute<{ total: string | null }>(sql`
    select coalesce(sum(amount_minor), 0)::bigint as total
      from payment_allocations where payment_id = ${paymentId}::uuid
  `);
  return Number(result.rows[0]?.total ?? 0);
}

/** Bir ücret kalemine tahsis edilmiş (iptal edilmemiş) toplam. */
export async function allocatedForCharge(tx: Tx, chargeId: string): Promise<number> {
  const result = await tx.execute<{ total: string | null }>(sql`
    select coalesce(sum(a.amount_minor), 0)::bigint as total
      from payment_allocations a
      join payments p on p.id = a.payment_id
     where a.charge_id = ${chargeId}::uuid
       and p.status = 'posted'
  `);
  return Number(result.rows[0]?.total ?? 0);
}
