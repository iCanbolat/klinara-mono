import { inArray, sql } from 'drizzle-orm';
import { charges } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type ChargeRow = typeof charges.$inferSelect;

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
