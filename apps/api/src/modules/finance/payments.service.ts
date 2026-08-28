import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { PG_ERROR, isPgError } from '../../common/errors/db-errors';
import { DEFAULT_PAGE_SIZE, decodeCursor, toPage } from '../../common/pagination';
import { versionConflict } from '../../common/http/etag';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import { CommissionAccrualService } from './commission-accrual.service';
import * as cashRepo from './cash.repository';
import * as repo from './finance.repository';
import type {
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PaymentAllocationDto,
  PaymentPageDto,
  PaymentResponseDto,
} from './dto/payment.dto';

interface AllocationPlan {
  chargeId: string;
  amountMinor: number;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
    private readonly commissions: CommissionAccrualService,
  ) {}

  /**
   * Tahsilat alır ve ücret kalemlerine dağıtır.
   *
   * Dağıtım verilmezse müşterinin açık kalemlerine ESKİDEN YENİYE otomatik
   * dağıtılır — resepsiyonun günlük akışı budur ("500 TL aldım, borcuna say").
   * Artan tutar tahsis edilmeden kalır ve avans olarak cari bakiyeyi düşürür;
   * hangi kaleme sayılacağı sonra belli olur.
   *
   * Tavan kuralları DB'de: tahsis toplamı tahsilatı (`K0012`), bir kaleme
   * tahsis edilen toplam da kalemin tutarını (`K0013`) aşamaz. Uygulama
   * hesabı doğru yapsa bile yarışan iki istek ancak orada durdurulabilir.
   *
   * NAKİT tahsilat açık bir kasa oturumuna bağlanmak ZORUNDADIR (6.3). Oturum
   * verilmezse şubenin açık oturumu bulunur; yoksa `CASH_SESSION_REQUIRED`.
   * Kural DB trigger'ında da var — kasa dışı nakit sessizce birikemez.
   */
  async create(
    principal: Principal,
    branchId: string,
    input: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    await this.branchAccess.assertInput(principal, branchId);

    return this.tx
      .run(async (tx) => {
        const plan =
          input.allocations === undefined
            ? await PaymentsService.autoAllocate(tx, input.customerId, input.amountMinor)
            : input.allocations.map((line) => ({
                chargeId: line.chargeId,
                amountMinor: line.amountMinor,
              }));

        const planned = plan.reduce((sum, line) => sum + line.amountMinor, 0);
        if (planned > input.amountMinor) {
          throw AppError.conflict(
            ERROR_CODES.PAYMENT_EXCEEDS_BALANCE,
            'Dağıtım toplamı tahsilat tutarını aşıyor',
            { detail: `Tahsilat ${input.amountMinor}, dağıtım ${planned}.` },
          );
        }

        const cashSessionId =
          input.method === 'cash'
            ? await PaymentsService.resolveCashSession(tx, branchId, input.cashSessionId)
            : null;

        const receiptNo = await repo.nextReceiptNo(tx, principal.tenantId);
        const payment = await repo.insertPayment(tx, {
          tenantId: principal.tenantId,
          branchId,
          customerId: input.customerId,
          method: input.method,
          amountMinor: input.amountMinor,
          receiptNo,
          paidAt: input.paidAt === undefined ? new Date() : new Date(input.paidAt),
          cashSessionId,
          note: input.note ?? null,
          collectedBy: principal.userId,
        });

        // Nakit AYNI transaction'da kasaya girer: tahsilat olup kasa hareketi
        // olmayan bir durum, gün sonu farkının kaynağı olurdu.
        if (cashSessionId !== null) {
          await cashRepo.insertMovement(tx, {
            tenantId: principal.tenantId,
            sessionId: cashSessionId,
            kind: 'payment',
            amountMinor: input.amountMinor,
            paymentId: payment.id,
            actorUserId: principal.userId,
            note: `Tahsilat #${receiptNo}`,
          });
        }

        await repo.insertAllocations(
          tx,
          plan.map((line) => ({
            tenantId: principal.tenantId,
            paymentId: payment.id,
            chargeId: line.chargeId,
            amountMinor: line.amountMinor,
          })),
        );

        // Tahsilat tetikleyicili primler AYNI transaction'da tahakkuk eder;
        // kısmi tahsilat oransal prim üretir (6.4).
        await this.commissions.accrueForPayment(tx, {
          tenantId: principal.tenantId,
          paymentId: payment.id,
          actorUserId: principal.userId,
        });

        const allocations = await repo.listAllocationsForPayments(tx, [payment.id]);
        return PaymentsService.present(payment, allocations.get(payment.id) ?? []);
      })
      .catch((error: unknown) => {
        throw PaymentsService.translate(error);
      });
  }

  async get(id: string): Promise<PaymentResponseDto> {
    const payload = await this.tx.run(async (tx) => {
      const payment = await repo.findPaymentById(tx, id);
      if (payment === undefined) return undefined;
      const allocations = await repo.listAllocationsForPayments(tx, [id]);
      return PaymentsService.present(payment, allocations.get(id) ?? []);
    });

    if (payload === undefined) throw AppError.notFound('Tahsilat bulunamadı');
    return payload;
  }

  async list(principal: Principal, query: ListPaymentsQueryDto): Promise<PaymentPageDto> {
    if (query.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, query.branchId);
    }
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);

    return this.tx.run(async (tx) => {
      const rows = await repo.listPayments(
        tx,
        {
          customerId: query.customerId,
          branchId: query.branchId,
          method: query.method,
          status: query.status,
          from: query.from === undefined ? undefined : new Date(query.from),
          to: query.to === undefined ? undefined : new Date(query.to),
        },
        { limit, cursor },
      );

      const page = toPage(rows, limit, (row) => ({
        sortKey: row.paidAt.toISOString(),
        id: row.id,
      }));
      const allocations = await repo.listAllocationsForPayments(
        tx,
        page.data.map((row) => row.id),
      );

      return {
        data: page.data.map((row) =>
          PaymentsService.present(row, allocations.get(row.id) ?? []),
        ),
        pageInfo: page.pageInfo,
      };
    });
  }

  /**
   * Tahsilatı iptal eder.
   *
   * Tahsis satırları SİLİNMEZ — append-only bir defterdir. Bakiye sorguları
   * `payments.status = 'posted'` filtresi taşıdığı için iptal, borcu
   * kendiliğinden geri getirir. Satırları silmek "bu para hiç girmedi" demek
   * olurdu; oysa girdi ve iade edildi, ikisi farklı olaydır.
   */
  async void(
    principal: Principal,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<PaymentResponseDto> {
    const payload = await this.tx
      .run(async (tx) => {
        const current = await repo.lockPaymentById(tx, id);
        if (current === undefined) return undefined;
        BranchAccessService.assertMembership(principal, current.branchId);

        if (current.status === 'void') {
          const existing = await repo.listAllocationsForPayments(tx, [id]);
          return PaymentsService.present(current, existing.get(id) ?? []);
        }

        const updated = await repo.updatePaymentWithVersion(tx, id, expectedVersion, {
          status: 'void',
          voidedAt: new Date(),
          voidedBy: principal.userId,
          voidedReason: reason,
        });
        if (updated === undefined) return { conflict: true as const };

        // Tahsilat iptali primi TERS KAYITLA düşer; tahakkuk satırı silinmez.
        await this.commissions.reverse(tx, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          reason,
          paymentId: id,
        });

        const allocations = await repo.listAllocationsForPayments(tx, [id]);
        return PaymentsService.present(updated, allocations.get(id) ?? []);
      })
      .catch((error: unknown) => {
        throw PaymentsService.translate(error);
      });

    if (payload === undefined) throw AppError.notFound('Tahsilat bulunamadı');
    if ('conflict' in payload) throw versionConflict();
    return payload;
  }

  /**
   * Nakit tahsilatın bağlanacağı açık kasa oturumu.
   *
   * İstemci oturum verdiyse onu doğrular; vermediyse şubenin açık oturumunu
   * bulur. İkisi de yoksa istek reddedilir — "kasasız nakit" diye bir şey yok.
   */
  private static async resolveCashSession(
    tx: Parameters<typeof cashRepo.findOpenSession>[0],
    branchId: string,
    requested: string | undefined,
  ): Promise<string> {
    if (requested !== undefined) return requested;

    const open = await cashRepo.findOpenSession(tx, branchId);
    if (open === undefined) {
      throw AppError.conflict(
        ERROR_CODES.CASH_SESSION_REQUIRED,
        'Nakit tahsilat için açık bir kasa oturumu gerekli',
        { detail: 'Önce `POST /cash-sessions/open` ile kasayı açın.' },
      );
    }
    return open.id;
  }

  /**
   * Açık kalemlere eskiden yeniye dağıtır.
   *
   * Artan tutar tahsis EDİLMEZ: uydurma bir kaleme yazmak yerine avans olarak
   * durur. Cari bakiye zaten `sum(charges) - sum(payments)` olduğu için avans
   * bakiyeye doğru yansır.
   */
  private static async autoAllocate(
    tx: Parameters<typeof repo.listOutstandingCharges>[0],
    customerId: string,
    amountMinor: number,
  ): Promise<AllocationPlan[]> {
    const outstanding = await repo.listOutstandingCharges(tx, customerId);
    const plan: AllocationPlan[] = [];
    let remaining = amountMinor;

    for (const charge of outstanding) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, charge.outstandingMinor);
      plan.push({ chargeId: charge.chargeId, amountMinor: amount });
      remaining -= amount;
    }
    return plan;
  }

  static present(
    row: repo.PaymentRow,
    allocations: repo.AllocationDetail[],
  ): PaymentResponseDto {
    const allocatedMinor = allocations.reduce((sum, line) => sum + line.amountMinor, 0);
    const lines: PaymentAllocationDto[] = allocations.map((line) => ({
      id: line.id,
      chargeId: line.chargeId,
      amountMinor: line.amountMinor,
      chargeDescription: line.chargeDescription,
    }));

    return {
      id: row.id,
      branchId: row.branchId,
      customerId: row.customerId,
      method: row.method,
      amountMinor: row.amountMinor,
      allocatedMinor,
      unallocatedMinor: row.amountMinor - allocatedMinor,
      currency: row.currency,
      receiptNo: row.receiptNo,
      paidAt: row.paidAt.toISOString(),
      cashSessionId: row.cashSessionId,
      note: row.note,
      status: row.status,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidedReason: row.voidedReason,
      allocations: lines,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Tahsilat kaynaklı DB hatalarının istemci karşılıkları. */
  static translate(error: unknown): unknown {
    if (
      isPgError(error, PG_ERROR.PAYMENT_EXCEEDS_CHARGE) ||
      isPgError(error, PG_ERROR.PAYMENT_OVER_ALLOCATED)
    ) {
      return AppError.conflict(
        ERROR_CODES.PAYMENT_EXCEEDS_BALANCE,
        'Tahsis edilen tutar bakiyeyi aşıyor',
        { detail: 'Bir kaleme tahsis edilen toplam, kalemin tutarını aşamaz.' },
      );
    }
    if (isPgError(error, PG_ERROR.CHARGE_NOT_OPEN)) {
      return AppError.conflict(
        ERROR_CODES.CONFLICT,
        'İptal edilmiş ya da negatif kaleme tahsilat tahsis edilemez',
      );
    }
    if (isPgError(error, PG_ERROR.CASH_SESSION_REQUIRED)) {
      return AppError.conflict(
        ERROR_CODES.CASH_SESSION_REQUIRED,
        'Nakit tahsilat için açık bir kasa oturumu gerekli',
      );
    }
    if (isPgError(error, PG_ERROR.PACKAGE_BINDING_INVALID)) {
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Tahsilat ve ücret kalemi aynı müşteriye ait olmalı',
      );
    }
    if (isPgError(error, PG_ERROR.RESTRICT_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Tahsis satırı değiştirilemez');
    }
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Bu tahsis zaten kayıtlı');
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Tahsilat geçersiz');
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Müşteri, şube ya da ücret kalemi bulunamadı',
      );
    }
    return error;
  }
}
