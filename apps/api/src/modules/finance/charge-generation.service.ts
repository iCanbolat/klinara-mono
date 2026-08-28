import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';
import { computeChargeAmounts, computeRefundAmounts } from './charge-math';
import * as repo from './finance.repository';

export interface PackageRefundLine {
  customerPackageItemId: string;
  amountMinor: number;
}

/**
 * Borcu DOĞURAN servis.
 *
 * ⚠️ Bu servis TRANSACTION AÇMAZ. Metotları `tx`'i parametre olarak alır ve
 * çağıranın transaction'ında koşar — deseni birebir
 * `packages/package-consumption.service.ts`. Sebebi aynı: randevu tamamlama
 * ile borcun doğması atomik olmalı, ve atomiklik ayrı bir mekanizma değil,
 * aynı transaction'da olmalarının doğal sonucudur.
 *
 * Bu servis PARANIN NASIL HAREKET ETTİĞİNİ bilmez; yalnız borcun doğduğunu
 * kaydeder. Tahsilat 0028'in, kasa 0029'un işidir.
 */
@Injectable()
export class ChargeGenerationService {
  /**
   * Randevu tamamlandığında hizmet ücretlerini yazar.
   *
   * Paketten karşılanan kalemler ATLANIR — o borç paket satıldığında zaten
   * doğdu; ikinci kez yazmak müşteriyi iki kez borçlandırırdı.
   *
   * İdempotent: `charges_appointment_service_once` kısmi tekil indeksi bir
   * randevu kalemi için en fazla bir AÇIK ücret kalemi bırakır. Aynı randevuyu
   * iki kez tamamlamak ikinci bir borç üretmez.
   */
  async generateForAppointment(
    tx: Tx,
    params: { tenantId: string; appointmentId: string; actorUserId: string },
  ): Promise<number> {
    const lines = await repo.listBillableAppointmentServices(tx, params.appointmentId);
    if (lines.length === 0) return 0;

    const existing = await ChargeGenerationService.existingChargeTargets(
      tx,
      params.appointmentId,
    );

    let created = 0;
    for (const line of lines) {
      if (existing.has(line.appointmentServiceId)) continue;

      const amounts = computeChargeAmounts({
        quantity: 1,
        unitPriceMinor: line.priceMinor,
        vatRateBasisPoints: line.vatRateBasisPoints,
      });

      await repo.insertCharge(tx, {
        tenantId: params.tenantId,
        branchId: line.branchId,
        customerId: line.customerId,
        source: 'appointment_service',
        appointmentServiceId: line.appointmentServiceId,
        description: line.serviceName,
        quantity: 1,
        // Randevu kalemi zaten satış anının SNAPSHOT'ıdır; liste ile uygulanan
        // fiyat burada aynıdır, override varsa randevu kaleminde yapılmıştır.
        unitListPriceMinor: line.priceMinor,
        unitPriceMinor: line.priceMinor,
        vatRateBasisPoints: line.vatRateBasisPoints,
        ...amounts,
        createdBy: params.actorUserId,
      });
      created += 1;
    }
    return created;
  }

  /**
   * Randevu tamamlaması geri alındığında borcu iptal eder.
   *
   * Satır SİLİNMEZ, `void` edilir: iptal edilmiş bir borç kalemi de denetim
   * izidir. Kaleme tahsilat yapılmışsa iptal edilmez — para girmiş bir borcu
   * yok saymak, cari bakiyeyi alacaklı tarafa kaydırırdı; bu durumda çağıran
   * önce tahsilatı iptal etmelidir.
   */
  async voidForAppointment(
    tx: Tx,
    params: { appointmentId: string; actorUserId: string; reason: string | undefined },
  ): Promise<number> {
    const open = await repo.listOpenChargesForAppointment(tx, params.appointmentId);
    let voided = 0;

    for (const charge of open) {
      await tx.execute(sql`
        update charges
           set status = 'void',
               voided_at = now(),
               voided_by = ${params.actorUserId}::uuid,
               voided_reason = ${params.reason ?? 'Randevu tamamlaması geri alındı'}
         where id = ${charge.id}::uuid
           and status = 'open'
      `);
      voided += 1;
    }
    return voided;
  }

  /**
   * Paket satışının borcunu yazar — KALEM BAŞINA BİR SATIR.
   *
   * Tek bir toplu satır yazmak, farklı KDV oranlı hizmetler içeren bir paketi
   * tek orana zorlardı. Tutar `item_total_minor`dan gelir (Faz 5'in kampanya
   * tahsisi), liste fiyatından değil — kampanyalı satılan paketin borcu liste
   * fiyatından yazılırsa müşteri ödemediği bir tutarla borçlanır.
   */
  async generateForPackageSale(
    tx: Tx,
    params: { tenantId: string; customerPackageId: string; actorUserId: string },
  ): Promise<number> {
    const result = await tx.execute<{
      item_id: string;
      service_name: string;
      item_total_minor: string | number;
      unit_list_price_minor: string | number;
      quantity_total: number;
      vat_rate_basis_points: number;
      branch_id: string;
      customer_id: string;
      definition_name: string;
    }>(sql`
      select i.id                    as item_id,
             i.service_name,
             i.item_total_minor,
             i.unit_list_price_minor,
             i.quantity_total,
             sv.vat_rate_basis_points,
             p.branch_id,
             p.customer_id,
             p.definition_name
        from customer_package_items i
        join customer_packages p on p.id = i.customer_package_id
        join services sv         on sv.id = i.service_id
       where i.customer_package_id = ${params.customerPackageId}::uuid
       order by i.sort_order, i.id
    `);

    for (const row of result.rows) {
      const itemTotal = Number(row.item_total_minor);
      const amounts = computeChargeAmounts({
        quantity: 1,
        unitPriceMinor: itemTotal,
        vatRateBasisPoints: row.vat_rate_basis_points,
      });

      await repo.insertCharge(tx, {
        tenantId: params.tenantId,
        branchId: row.branch_id,
        customerId: row.customer_id,
        source: 'package_sale',
        customerPackageId: params.customerPackageId,
        description: `${row.definition_name} — ${row.service_name} (${row.quantity_total} seans)`,
        quantity: 1,
        // Liste karşılığı: seans başına liste fiyatı × satılan seans. Kampanya
        // indirimi bu iki sayının farkından okunur.
        unitListPriceMinor: Number(row.unit_list_price_minor) * row.quantity_total,
        unitPriceMinor: itemTotal,
        vatRateBasisPoints: row.vat_rate_basis_points,
        ...amounts,
        createdBy: params.actorUserId,
      });
    }
    return result.rows.length;
  }

  /**
   * Paket iadesinin NEGATİF borç kalemlerini yazar.
   *
   * Tutar Faz 5'in `remainingValueMinor` hesabından gelir (satış anındaki
   * `item_total_minor` üzerinden) ve burada yalnız KDV'si ayrılır. Bu kalem
   * "klinik bu parayı borçlandı" der; paranın kasadan ÇIKMASI 0029'un işidir
   * ve `refund_settlement_status` orada `settled`'a döner.
   */
  async generateForPackageRefund(
    tx: Tx,
    params: {
      tenantId: string;
      customerPackageId: string;
      actorUserId: string;
      lines: PackageRefundLine[];
      reason: string;
    },
  ): Promise<number> {
    const billable = params.lines.filter((line) => line.amountMinor > 0);
    if (billable.length === 0) return 0;

    const meta = await ChargeGenerationService.refundLineMeta(tx, params.customerPackageId);

    for (const line of billable) {
      const info = meta.get(line.customerPackageItemId);
      if (info === undefined) {
        throw new Error(`Paket kalemi bulunamadı: ${line.customerPackageItemId}`);
      }

      const amounts = computeRefundAmounts(line.amountMinor, info.vatRateBasisPoints);
      await repo.insertCharge(tx, {
        tenantId: params.tenantId,
        branchId: info.branchId,
        customerId: info.customerId,
        source: 'package_refund',
        customerPackageId: params.customerPackageId,
        description: `İade: ${info.definitionName} — ${info.serviceName} (${params.reason})`,
        quantity: 1,
        unitListPriceMinor: line.amountMinor,
        unitPriceMinor: line.amountMinor,
        vatRateBasisPoints: info.vatRateBasisPoints,
        ...amounts,
        createdBy: params.actorUserId,
      });
    }
    return billable.length;
  }

  /** Randevunun AÇIK ücret kalemlerinin kimlikleri (prim ters kaydı için). */
  async openChargeIdsForAppointment(tx: Tx, appointmentId: string): Promise<string[]> {
    const rows = await repo.listOpenChargesForAppointment(tx, appointmentId);
    return rows.map((row) => row.id);
  }

  /** Bu randevu için hangi kalemlerin borcu zaten yazılmış. */
  private static async existingChargeTargets(
    tx: Tx,
    appointmentId: string,
  ): Promise<Set<string>> {
    const result = await tx.execute<{ appointment_service_id: string }>(sql`
      select c.appointment_service_id
        from charges c
        join appointment_services s on s.id = c.appointment_service_id
       where s.appointment_id = ${appointmentId}::uuid
         and c.status = 'open'
    `);
    return new Set(result.rows.map((row) => row.appointment_service_id));
  }

  private static async refundLineMeta(
    tx: Tx,
    customerPackageId: string,
  ): Promise<
    Map<
      string,
      {
        serviceName: string;
        definitionName: string;
        vatRateBasisPoints: number;
        branchId: string;
        customerId: string;
      }
    >
  > {
    const result = await tx.execute<{
      item_id: string;
      service_name: string;
      definition_name: string;
      vat_rate_basis_points: number;
      branch_id: string;
      customer_id: string;
    }>(sql`
      select i.id as item_id,
             i.service_name,
             p.definition_name,
             sv.vat_rate_basis_points,
             p.branch_id,
             p.customer_id
        from customer_package_items i
        join customer_packages p on p.id = i.customer_package_id
        join services sv         on sv.id = i.service_id
       where i.customer_package_id = ${customerPackageId}::uuid
    `);

    return new Map(
      result.rows.map((row) => [
        row.item_id,
        {
          serviceName: row.service_name,
          definitionName: row.definition_name,
          vatRateBasisPoints: row.vat_rate_basis_points,
          branchId: row.branch_id,
          customerId: row.customer_id,
        },
      ]),
    );
  }
}
