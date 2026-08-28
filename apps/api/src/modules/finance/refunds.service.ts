import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, PERMISSIONS } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { PG_ERROR, isPgError, pgConstraintName } from '../../common/errors/db-errors';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { hasPermission, type Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import * as cashRepo from './cash.repository';
import { CashSessionsService } from './cash-sessions.service';
import type { CreateRefundDto, RefundResponseDto } from './dto/cash.dto';

@Injectable()
export class RefundsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  /**
   * İade — PARANIN FİİLEN ÇIKTIĞI yer.
   *
   * Faz 5'ten devreden açık madde burada kapanır: 5.3'ün iade akışı
   * `refund_settlement_status = 'pending'` yazıp duruyor, 6.1 negatif ücret
   * kalemini doğuruyordu. Bu uç o kalemi kapatır, nakitse kasadan çıkarır ve
   * paketin mutabakat durumunu `settled`'a çeker.
   *
   * Paket iadesi ayrıca `package:refund` ister: `finance.payment:write` tek
   * başına yetseydi, resepsiyon paket iadesini 5.3'ün kapısından değil bu
   * kapıdan yapabilirdi — aynı yetkinin iki farklı ölçüsü olurdu.
   */
  async create(
    principal: Principal,
    branchId: string,
    input: CreateRefundDto,
  ): Promise<RefundResponseDto> {
    await this.branchAccess.assertInput(principal, branchId);

    if (input.kind === 'package') {
      if (input.customerPackageId === undefined) {
        throw new AppError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'Paket iadesinde `customerPackageId` zorunlu',
        );
      }
      if (!hasPermission(principal, PERMISSIONS.PACKAGE_REFUND)) {
        throw AppError.forbidden('Paket iadesi için yetkiniz yok', {
          detail: `Gereken izin: ${PERMISSIONS.PACKAGE_REFUND}`,
        });
      }
    }

    return this.tx
      .run(async (tx) => {
        const cashSessionId =
          input.method === 'cash'
            ? await RefundsService.resolveCashSession(tx, branchId, input.cashSessionId)
            : null;

        const refund = await cashRepo.insertRefund(tx, {
          tenantId: principal.tenantId,
          branchId,
          customerId: input.customerId,
          kind: input.kind,
          amountMinor: input.amountMinor,
          method: input.method,
          chargeId: input.chargeId ?? null,
          customerPackageId: input.customerPackageId ?? null,
          cashSessionId,
          reason: input.reason,
          refundedBy: principal.userId,
        });

        // Nakit çıkışı AYNI transaction'da kasaya düşer, işareti NEGATİF.
        if (cashSessionId !== null) {
          await cashRepo.insertMovement(tx, {
            tenantId: principal.tenantId,
            sessionId: cashSessionId,
            kind: 'refund',
            amountMinor: -input.amountMinor,
            refundId: refund.id,
            actorUserId: principal.userId,
            note: input.reason,
          });
        }

        const settlementStatus =
          input.customerPackageId === undefined
            ? null
            : await RefundsService.settlePackage(tx, input.customerPackageId);

        return RefundsService.present(refund, settlementStatus);
      })
      .catch((error: unknown) => {
        throw RefundsService.translate(error);
      });
  }

  /**
   * Paketin mutabakat durumunu `settled`'a çeker.
   *
   * `pending` olmayan bir paket sessizce ATLANIR (dönen `null` bunu söyler):
   * hizmet iadesi paket durumuna dokunmaz, ve zaten kapatılmış bir paketi
   * ikinci kez kapatmak bir şey değiştirmez.
   */
  private static async settlePackage(tx: Tx, customerPackageId: string): Promise<string | null> {
    const result = await tx.execute<{ refund_settlement_status: string }>(sql`
      update customer_packages
         set refund_settlement_status = 'settled'
       where id = ${customerPackageId}::uuid
         and refund_settlement_status = 'pending'
      returning refund_settlement_status
    `);
    return result.rows[0]?.refund_settlement_status ?? null;
  }

  private static async resolveCashSession(
    tx: Tx,
    branchId: string,
    requested: string | undefined,
  ): Promise<string> {
    if (requested !== undefined) return requested;

    const open = await cashRepo.findOpenSession(tx, branchId);
    if (open === undefined) {
      throw AppError.conflict(
        ERROR_CODES.CASH_SESSION_REQUIRED,
        'Nakit iade için açık bir kasa oturumu gerekli',
        { detail: 'Önce `POST /cash-sessions/open` ile kasayı açın.' },
      );
    }
    return open.id;
  }

  static present(
    row: cashRepo.RefundRow,
    packageSettlementStatus: string | null,
  ): RefundResponseDto {
    return {
      id: row.id,
      customerId: row.customerId,
      kind: row.kind,
      amountMinor: row.amountMinor,
      method: row.method,
      chargeId: row.chargeId,
      customerPackageId: row.customerPackageId,
      cashSessionId: row.cashSessionId,
      reason: row.reason,
      refundedAt: row.refundedAt.toISOString(),
      packageSettlementStatus,
    };
  }

  static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.PAYMENT_EXCEEDS_CHARGE)) {
      return AppError.conflict(
        ERROR_CODES.PAYMENT_EXCEEDS_BALANCE,
        'İade tutarı kalemin tutarını aşıyor',
      );
    }
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      const constraint = pgConstraintName(error);
      if (constraint === 'refunds_charge_once') {
        return AppError.conflict(ERROR_CODES.CONFLICT, 'Bu kalem zaten iade edilmiş');
      }
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Kayıt zaten mevcut');
    }
    if (isPgError(error, PG_ERROR.PACKAGE_BINDING_INVALID)) {
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'İade kalemi müşteriyle uyuşmuyor',
      );
    }
    const translated = CashSessionsService.translate(error);
    if (translated !== error) return translated;
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Müşteri, kalem ya da paket bulunamadı',
      );
    }
    return error;
  }
}
