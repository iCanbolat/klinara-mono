import type pg from 'pg';
import type { ClinicFixture } from './clinic';

/**
 * Rapor testleri için doğrudan bir ücret kalemi yazar.
 *
 * Elle kalem açan uç (`POST /charges`) 0045 ile kaldırıldı; üretimde kalemler
 * yalnız randevu tamamlanınca ve paket satılınca doğuyor. Ciro raporunun
 * aritmetiğini sınamak için o akışların tamamını kurmak gerekmiyor — sahip
 * rolüyle satır yazmak yeterli (KDV %20, fiyat KDV dahil).
 */
export async function insertCharge(
  pool: pg.Pool,
  clinic: ClinicFixture,
  amountMinor: number,
  description: string,
): Promise<string> {
  const vatMinor = Math.round((amountMinor * 2000) / 12000);
  const result = await pool.query<{ id: string }>(
    `insert into charges
       (tenant_id, branch_id, customer_id, source, description, quantity,
        unit_list_price_minor, unit_price_minor, vat_rate_basis_points,
        total_minor, net_minor, vat_minor)
     values ($1, $2, $3, 'manual', $4, 1, $5, $5, 2000, $5, $6, $7)
     returning id`,
    [
      clinic.tenant.id,
      clinic.branch.id,
      clinic.customer.id,
      description,
      amountMinor,
      amountMinor - vatMinor,
      vatMinor,
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('Ücret kalemi yazılamadı');
  return id;
}

/** Kalemi `void` eder — ciro raporundan düşmesi gereken durum. */
export async function voidCharge(pool: pg.Pool, chargeId: string, reason: string): Promise<void> {
  await pool.query(
    `update charges set status = 'void', voided_at = now(), voided_reason = $2 where id = $1`,
    [chargeId, reason],
  );
}
