import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { remainingValueMinor } from '../../common/money';
import { versionConflict } from '../../common/http/etag';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import type { Principal } from '../identity/principal';
import { CustomerPackagesService } from './customer-packages.service';
import { PackageConsumptionService } from './package-consumption.service';
import * as repo from './customer-packages.repository';
import type {
  AdjustPackageDto,
  ConsumePackageDto,
  ConsumePackageResultDto,
  PackageEntitlementDto,
  RefundPackageDto,
  RefundResultDto,
  TransferPackageDto,
} from './dto/package-operation.dto';
import type { CustomerPackageResponseDto } from './dto/customer-package.dto';

type PackagePatch = Parameters<typeof repo.updatePackage>[2];

@Injectable()
export class PackageOperationsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly packages: CustomerPackagesService,
    private readonly consumption: PackageConsumptionService,
  ) {}

  /** Randevu ekranının paket seçimi: kullanılabilir kalemler. */
  async listEntitlements(
    customerId: string,
    filters: { serviceId?: string | undefined; branchId?: string | undefined },
  ): Promise<PackageEntitlementDto[]> {
    const result = await this.tx.run((tx) =>
      tx.execute<Record<string, unknown>>(sql`
        select i.id, i.customer_package_id, i.service_id, i.service_name,
               i.remaining_sessions, p.definition_name, p.expires_at, p.branch_id
          from customer_package_items i
          join customer_packages p on p.id = i.customer_package_id
         where p.customer_id = ${customerId}::uuid
           and p.deleted_at is null
           and p.status = 'active'
           and (p.expires_at is null or p.expires_at > now())
           and i.remaining_sessions > 0
           and (${filters.serviceId ?? null}::uuid is null
                or i.service_id = ${filters.serviceId ?? null}::uuid)
           and (${filters.branchId ?? null}::uuid is null
                or p.branch_id = ${filters.branchId ?? null}::uuid)
         order by p.expires_at asc nulls last, p.sold_at asc, i.id
      `),
    );

    return result.rows.map((row) => ({
      customerPackageItemId: row.id as string,
      customerPackageId: row.customer_package_id as string,
      packageName: row.definition_name as string,
      serviceId: row.service_id as string,
      serviceName: row.service_name as string,
      remainingSessions: Number(row.remaining_sessions),
      expiresAt: row.expires_at == null ? null : new Date(row.expires_at as string).toISOString(),
      branchId: row.branch_id as string,
    }));
  }

  /**
   * Randevu kalemlerini pakete bağlar; randevu zaten `completed` ise düşer de.
   *
   * Bağlama ile tüketimin aynı uçta olmasının sebebi: resepsiyon randevuyu
   * tamamladıktan sonra "aslında paketten düşecekti" dediğinde iki ayrı çağrı
   * yapmak zorunda kalmasın.
   */
  async consumeForAppointment(
    principal: Principal,
    appointmentId: string,
    input: ConsumePackageDto,
  ): Promise<ConsumePackageResultDto> {
    return this.tx
      .run(async (tx) => {
        const appointment = await tx.execute<{ status: string }>(sql`
          select status from appointments
           where id = ${appointmentId}::uuid and deleted_at is null
        `);
        const status = appointment.rows[0]?.status;
        if (status === undefined) throw AppError.notFound('Randevu bulunamadı');

        for (const line of input.lines) {
          await this.consumption.bind(tx, {
            appointmentServiceId: line.appointmentServiceId,
            customerPackageItemId: line.customerPackageItemId,
          });
        }

        const consumed =
          status === 'completed'
            ? await this.consumption.consumeForAppointment(tx, {
                tenantId: this.tx.tenantId,
                appointmentId,
                actorUserId: principal.userId,
              })
            : 0;

        return { bound: input.lines.length, consumed };
      })
      .catch((error: unknown) => {
        throw CustomerPackagesService.translate(error);
      });
  }

  /** Manuel düzeltme — gerekçe zorunlu, iz kalıcı. */
  async adjust(
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: AdjustPackageDto,
  ): Promise<CustomerPackageResponseDto> {
    if (input.items.some((item) => item.delta === 0)) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Düzeltme miktarı sıfır olamaz');
    }

    return this.write(id, expectedVersion, async (tx) => {
      const items = await PackageOperationsService.itemsById(tx, id);
      for (const entry of input.items) {
        const item = items.get(entry.customerPackageItemId);
        if (item === undefined) throw AppError.notFound('Paket kalemi bu pakete ait değil');

        await repo.insertLedgerEntry(tx, {
          tenantId: this.tx.tenantId,
          customerPackageId: id,
          customerPackageItemId: item.id,
          entryType: 'manual_adjustment',
          delta: entry.delta,
          actorUserId: principal.userId,
          reason: input.reason,
        });
      }
    });
  }

  /**
   * İade.
   *
   * Tutar SATIŞ ANINDAKİ tahsisten hesaplanır (`item_total_minor`), güncel
   * katalog fiyatından değil. İstemci tutar gönderemez: fiyat override izni
   * (`finance.price:override`) Faz 6.1'de geliyor, şimdi o kapıyı açmak
   * yetkisiz indirim demek olurdu.
   *
   * Kasa hareketi YOK. `refund_settlement_status = 'pending'` bir borcun
   * doğduğunu söyler; Batch 6.2 bunu okuyup negatif charge üretecek.
   */
  async refund(
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: RefundPackageDto,
  ): Promise<RefundResultDto> {
    let refundedSessions = 0;
    let refundAmountMinor = 0;

    await this.write(id, expectedVersion, async (tx, pkg) => {
      const items = await PackageOperationsService.itemsById(tx, id);
      const requested =
        input.items ??
        [...items.values()]
          .filter((item) => item.remainingSessions > 0)
          .map((item) => ({
            customerPackageItemId: item.id,
            sessions: item.remainingSessions,
          }));

      if (requested.length === 0) {
        throw AppError.conflict(ERROR_CODES.CONFLICT, 'İade edilecek kalan hak yok');
      }

      for (const entry of requested) {
        const item = items.get(entry.customerPackageItemId);
        if (item === undefined) throw AppError.notFound('Paket kalemi bu pakete ait değil');
        if (entry.sessions > item.remainingSessions) {
          throw AppError.conflict(
            ERROR_CODES.PACKAGE_EXHAUSTED,
            'İade edilen seans kalan haktan fazla olamaz',
          );
        }

        await repo.insertLedgerEntry(tx, {
          tenantId: this.tx.tenantId,
          customerPackageId: id,
          customerPackageItemId: item.id,
          entryType: 'refund',
          delta: -entry.sessions,
          actorUserId: principal.userId,
          reason: input.reason,
        });

        refundedSessions += entry.sessions;
        refundAmountMinor += remainingValueMinor(
          item.itemTotalMinor,
          item.quantityTotal,
          entry.sessions,
        );
      }

      const remainingAfter = pkg.remainingSessions - refundedSessions;
      return {
        refundedSessions: pkg.refundedSessions + refundedSessions,
        refundAmountMinor: pkg.refundAmountMinor + refundAmountMinor,
        refundReason: input.reason,
        refundedAt: new Date(),
        refundedBy: principal.userId,
        refundSettlementStatus: 'pending' as const,
        ...(remainingAfter === 0 ? { status: 'refunded' as const } : {}),
      };
    });

    return { refundedSessions, refundAmountMinor, settlementStatus: 'pending' };
  }

  /**
   * Başka müşteriye devir.
   *
   * Hedef için YENİ bir `customer_packages` satırı açılır: aynı snapshot, AYNI
   * `expires_at` (süre uzatmak paranın karşılığını sessizce artırırdı) ve
   * taşınan değere eşit bir satış tutarı. Kaynağın para kolonlarına
   * DOKUNULMAZ; yükümlülük `item_total × remaining / quantity_total` olduğu
   * için kaynağın borcu tam olarak taşınan değer kadar düşer.
   */
  async transfer(
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: TransferPackageDto,
  ): Promise<CustomerPackageResponseDto> {
    let targetId = '';

    await this.write(id, expectedVersion, async (tx, pkg) => {
      if (!pkg.isTransferable) {
        throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu paket devredilemez', {
          detail: 'Satış anındaki tanım devre kapalıydı.',
        });
      }
      if (pkg.customerId === input.targetCustomerId) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Paket aynı müşteriye devredilemez');
      }

      const items = await PackageOperationsService.itemsById(tx, id);
      const requested =
        input.items ??
        [...items.values()]
          .filter((item) => item.remainingSessions > 0)
          .map((item) => ({
            customerPackageItemId: item.id,
            sessions: item.remainingSessions,
          }));

      if (requested.length === 0) {
        throw AppError.conflict(ERROR_CODES.CONFLICT, 'Devredilecek kalan hak yok');
      }

      const moves = requested.map((entry) => {
        const item = items.get(entry.customerPackageItemId);
        if (item === undefined) throw AppError.notFound('Paket kalemi bu pakete ait değil');
        if (entry.sessions > item.remainingSessions) {
          throw AppError.conflict(
            ERROR_CODES.PACKAGE_EXHAUSTED,
            'Devredilen seans kalan haktan fazla olamaz',
          );
        }
        return {
          item,
          sessions: entry.sessions,
          valueMinor: remainingValueMinor(item.itemTotalMinor, item.quantityTotal, entry.sessions),
        };
      });

      const totalValue = moves.reduce((sum, move) => sum + move.valueMinor, 0);

      const target = await repo.insertPackage(tx, {
        tenantId: this.tx.tenantId,
        customerId: input.targetCustomerId,
        branchId: pkg.branchId,
        definitionId: pkg.definitionId,
        definitionName: pkg.definitionName,
        definitionRevision: pkg.definitionRevision,
        totalPriceMinor: totalValue,
        currency: pkg.currency,
        isTransferable: pkg.isTransferable,
        validityDays: pkg.validityDays,
        soldAt: pkg.soldAt,
        expiresAt: pkg.expiresAt,
        transferredFromPackageId: pkg.id,
        soldBy: principal.userId,
        note: input.reason,
      });
      targetId = target.id;

      const targetItems = await repo.insertItems(
        tx,
        moves.map((move, index) => ({
          tenantId: this.tx.tenantId,
          customerPackageId: target.id,
          serviceId: move.item.serviceId,
          serviceName: move.item.serviceName,
          quantityTotal: move.sessions,
          unitListPriceMinor: move.item.unitListPriceMinor,
          itemTotalMinor: move.valueMinor,
          sortOrder: index,
        })),
      );

      for (const [index, move] of moves.entries()) {
        const targetItem = targetItems[index];
        if (targetItem === undefined) throw new Error('Devir hedefi kalemi yazılamadı');

        const out = await repo.insertLedgerEntry(tx, {
          tenantId: this.tx.tenantId,
          customerPackageId: id,
          customerPackageItemId: move.item.id,
          entryType: 'transfer_out',
          delta: -move.sessions,
          actorUserId: principal.userId,
          reason: input.reason,
        });
        const incoming = await repo.insertLedgerEntry(tx, {
          tenantId: this.tx.tenantId,
          customerPackageId: target.id,
          customerPackageItemId: targetItem.id,
          entryType: 'transfer_in',
          delta: move.sessions,
          actorUserId: principal.userId,
          reason: input.reason,
        });

        await tx.execute(sql`
          insert into package_transfers
            (tenant_id, source_package_id, source_item_id, target_package_id, target_item_id,
             sessions, value_minor, out_entry_id, in_entry_id, reason, actor_user_id)
          values (${this.tx.tenantId}::uuid, ${id}::uuid, ${move.item.id}::uuid,
                  ${target.id}::uuid, ${targetItem.id}::uuid,
                  ${move.sessions}, ${move.valueMinor},
                  ${out.id}::uuid, ${incoming.id}::uuid,
                  ${input.reason}, ${principal.userId}::uuid)
        `);
      }

      const remainingAfter =
        pkg.remainingSessions - moves.reduce((sum, move) => sum + move.sessions, 0);
      return remainingAfter === 0 ? { status: 'transferred' as const } : {};
    });

    const loaded = await this.tx.run((tx) => this.packages.load(tx, targetId));
    if (loaded === undefined) throw new Error('Devredilen paket okunamadı');
    return loaded;
  }

  /**
   * Yazma yolunun ortak iskeleti.
   *
   * SIRA ÖNEMLİ: önce `updateWithVersion` — sürüm tutmuyorsa HİÇBİR defter
   * satırı yazılmadan 409 ile çıkılır. Defter satırları sonra gelir ve
   * trigger paketi tekrar güncelleyip `version`ı bir daha artırır; bu doğru
   * davranış, çünkü her defter yazımı açık ETag'leri geçersizler.
   */
  private async write(
    id: string,
    expectedVersion: number,
    work: (tx: Tx, pkg: repo.CustomerPackageRow) => Promise<PackagePatch | undefined | void>,
  ): Promise<CustomerPackageResponseDto> {
    const payload = await this.tx
      .run(async (tx) => {
        const pkg = await repo.lockPackageById(tx, id);
        if (pkg === undefined) return undefined;
        if (pkg.version !== expectedVersion) return { conflict: true as const };

        // Sürüm ELLE doğrulandı ve satır kilitli; yamayı sürüm koşuluyla
        // yazmak çalışmazdı, çünkü aradaki defter satırları trigger üzerinden
        // `version`ı zaten artırıyor.
        const patch = (await work(tx, pkg)) ?? {};
        await repo.updatePackage(tx, id, patch);

        return this.packages.load(tx, id);
      })
      .catch((error: unknown) => {
        throw CustomerPackagesService.translate(error);
      });

    if (payload === undefined) throw AppError.notFound('Müşteri paketi bulunamadı');
    if ('conflict' in payload) throw versionConflict();
    return payload;
  }

  private static async itemsById(
    tx: Tx,
    packageId: string,
  ): Promise<Map<string, repo.CustomerPackageItemRow>> {
    const items = await repo.lockItemsForPackage(tx, packageId);
    return new Map(items.map((item) => [item.id, item]));
  }
}
