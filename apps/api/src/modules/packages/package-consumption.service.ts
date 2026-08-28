import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';
import * as repo from './customer-packages.repository';

interface ConsumableLine {
  appointmentServiceId: string;
  customerPackageItemId: string;
  customerPackageId: string;
  consumedEntryId: string | null;
}

/**
 * Randevu tamamlanınca seans hakkını düşen servis.
 *
 * ⚠️ Bu servis TRANSACTION AÇMAZ. Metotları `tx`'i parametre olarak alır ve
 * çağıranın (AppointmentsService.changeStatus) transaction'ında koşar.
 * Sebebi 5.3'ün kabul kriteri: "randevu tamamlama ile seans düşme atomiktir —
 * biri olup diğeri olmaz". Atomiklik ayrı bir mekanizma değil, aynı
 * transaction'da olmalarının doğal sonucudur.
 */
@Injectable()
export class PackageConsumptionService {
  /**
   * Randevunun pakete bağlı kalemlerini tüketir.
   *
   * Zaten tüketilmiş kalem ATLANIR: aynı randevuyu iki kez tamamlamak iki kez
   * düşmez. Hak yetersizse ya da paket süresi dolmuşsa trigger hata fırlatır,
   * transaction düşer ve randevu tamamlanmaz.
   */
  async consumeForAppointment(
    tx: Tx,
    params: { tenantId: string; appointmentId: string; actorUserId: string },
  ): Promise<number> {
    const lines = await PackageConsumptionService.lockLines(tx, params.appointmentId);
    let consumed = 0;

    for (const line of lines) {
      if (line.consumedEntryId !== null) continue;

      const entry = await repo.insertLedgerEntry(tx, {
        tenantId: params.tenantId,
        customerPackageId: line.customerPackageId,
        customerPackageItemId: line.customerPackageItemId,
        entryType: 'consume',
        delta: -1,
        appointmentId: params.appointmentId,
        appointmentServiceId: line.appointmentServiceId,
        actorUserId: params.actorUserId,
      });

      await tx.execute(sql`
        update appointment_services
           set package_consumed_entry_id = ${entry.id}::uuid
         where id = ${line.appointmentServiceId}::uuid
           and package_consumed_entry_id is null
      `);
      consumed += 1;
    }
    return consumed;
  }

  /**
   * Tamamlama geri alındığında ters kayıt üretir.
   *
   * Satır SİLİNMEZ: defter append-only'dir, düzeltme de iz bırakır.
   * `package_ledger_reversal_once` tekil indeksi bir kaydın en fazla bir kez
   * geri alınmasını garanti eder.
   */
  async reverseForAppointment(
    tx: Tx,
    params: {
      tenantId: string;
      appointmentId: string;
      actorUserId: string;
      reason: string | undefined;
    },
  ): Promise<number> {
    const lines = await PackageConsumptionService.lockLines(tx, params.appointmentId);
    let reversed = 0;

    for (const line of lines) {
      if (line.consumedEntryId === null) continue;

      await repo.insertLedgerEntry(tx, {
        tenantId: params.tenantId,
        customerPackageId: line.customerPackageId,
        customerPackageItemId: line.customerPackageItemId,
        entryType: 'consume',
        delta: 1,
        appointmentId: params.appointmentId,
        appointmentServiceId: line.appointmentServiceId,
        actorUserId: params.actorUserId,
        reason: params.reason ?? 'Randevu tamamlaması geri alındı',
        reversesEntryId: line.consumedEntryId,
      });

      await tx.execute(sql`
        update appointment_services
           set package_consumed_entry_id = null
         where id = ${line.appointmentServiceId}::uuid
      `);
      reversed += 1;
    }
    return reversed;
  }

  /** Randevu kalemini bir paket kalemine bağlar (tüketmez). */
  async bind(
    tx: Tx,
    params: { appointmentServiceId: string; customerPackageItemId: string | null },
  ): Promise<void> {
    await tx.execute(sql`
      update appointment_services
         set customer_package_item_id = ${params.customerPackageItemId}::uuid
       where id = ${params.appointmentServiceId}::uuid
         and package_consumed_entry_id is null
    `);
  }

  /**
   * Bağlı kalemleri SABİT SIRAYLA kilitler.
   *
   * Sıralama keyfi değil: aynı randevunun kalemleri her transaction'da aynı
   * sırayla kilitlenmezse iki eş zamanlı tamamlama birbirini bekleyip
   * deadlock üretir.
   */
  private static async lockLines(tx: Tx, appointmentId: string): Promise<ConsumableLine[]> {
    const result = await tx.execute<Record<string, unknown>>(sql`
      select s.id, s.customer_package_item_id, s.package_consumed_entry_id,
             i.customer_package_id
        from appointment_services s
        join customer_package_items i on i.id = s.customer_package_item_id
       where s.appointment_id = ${appointmentId}::uuid
         and s.customer_package_item_id is not null
       order by s.id
         for no key update of s
    `);

    return result.rows.map((row) => ({
      appointmentServiceId: row.id as string,
      customerPackageItemId: row.customer_package_item_id as string,
      customerPackageId: row.customer_package_id as string,
      consumedEntryId: (row.package_consumed_entry_id ?? null) as string | null,
    }));
  }
}
