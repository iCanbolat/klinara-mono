import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { PG_ERROR, isPgError, pgConstraintName } from '../../common/errors/db-errors';
import { DEFAULT_PAGE_SIZE, decodeCursor, toPage } from '../../common/pagination';
import { versionConflict } from '../../common/http/etag';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import * as repo from './cash.repository';
import type {
  CashMovementDto,
  CashSessionPageDto,
  CashSessionResponseDto,
  CashSessionSummaryDto,
  CloseCashSessionDto,
  ListCashSessionsQueryDto,
  OpenCashSessionDto,
} from './dto/cash.dto';
import type { PaymentMethod } from '../../database/schema';

@Injectable()
export class CashSessionsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  /**
   * Kasa açar.
   *
   * Şube başına tek açık oturum kuralı DB'de (`cash_sessions_single_open_key`
   * kısmi tekil indeksi). Uygulamada "önce bak, sonra aç" yapılsaydı iki
   * eş zamanlı açılış ikisini de geçirirdi.
   *
   * Açılış bakiyesi ayrı bir kolon OLARAK DA durur ama beklenen tutar hesabına
   * bir `opening` HAREKETİ üzerinden girer; böylece "beklenen = hareketlerin
   * toplamı" formülü istisnasızdır.
   */
  async open(
    principal: Principal,
    branchId: string,
    input: OpenCashSessionDto,
  ): Promise<CashSessionResponseDto> {
    await this.branchAccess.assertInput(principal, branchId);
    const openingBalanceMinor = input.openingBalanceMinor ?? 0;

    const row = await this.tx
      .run(async (tx) => {
        const session = await repo.insertSession(tx, {
          tenantId: principal.tenantId,
          branchId,
          openedBy: principal.userId,
          openingBalanceMinor,
        });

        if (openingBalanceMinor > 0) {
          await repo.insertMovement(tx, {
            tenantId: principal.tenantId,
            sessionId: session.id,
            kind: 'opening',
            amountMinor: openingBalanceMinor,
            actorUserId: principal.userId,
            note: 'Açılış bakiyesi',
          });
        }
        return session;
      })
      .catch((error: unknown) => {
        throw CashSessionsService.translate(error);
      });

    return CashSessionsService.present(row);
  }

  /**
   * Kasa kapatır.
   *
   * Beklenen tutar HESAPLANIR, saklanan bir sayaçtan okunmaz. Fark varsa
   * gerekçe zorunludur — kural hem burada (anlamlı hata için) hem de
   * `cash_sessions_difference_reason` constraint'inde.
   */
  async close(
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: CloseCashSessionDto,
  ): Promise<CashSessionResponseDto> {
    const payload = await this.tx
      .run(async (tx) => {
        const current = await repo.lockSessionById(tx, id);
        if (current === undefined) return undefined;
        BranchAccessService.assertMembership(principal, current.branchId);

        if (current.closedAt !== null) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Kasa oturumu zaten kapalı');
        }

        const expectedMinor = await repo.expectedCashMinor(tx, id);
        const differenceMinor = input.countedMinor - expectedMinor;

        if (differenceMinor !== 0 && (input.differenceReason ?? '').trim().length < 5) {
          throw new AppError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            'Sayım farkı için gerekçe zorunlu',
            {
              detail: `Beklenen ${expectedMinor}, sayılan ${input.countedMinor}.`,
              extra: { expectedMinor, countedMinor: input.countedMinor, differenceMinor },
            },
          );
        }

        const updated = await repo.updateSessionWithVersion(tx, id, expectedVersion, {
          closedAt: new Date(),
          closedBy: principal.userId,
          expectedMinor,
          countedMinor: input.countedMinor,
          differenceMinor,
          differenceReason: differenceMinor === 0 ? null : (input.differenceReason ?? null),
        });
        if (updated === undefined) return { conflict: true as const };
        return updated;
      })
      .catch((error: unknown) => {
        throw CashSessionsService.translate(error);
      });

    if (payload === undefined) throw AppError.notFound('Kasa oturumu bulunamadı');
    if ('conflict' in payload) throw versionConflict();
    return CashSessionsService.present(payload);
  }

  async list(
    principal: Principal,
    query: ListCashSessionsQueryDto,
  ): Promise<CashSessionPageDto> {
    if (query.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, query.branchId);
    }
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);

    const rows = await this.tx.run((tx) =>
      repo.listSessions(
        tx,
        { branchId: query.branchId, status: query.status },
        { limit, cursor },
      ),
    );
    const page = toPage(rows, limit, (row) => ({
      sortKey: row.openedAt.toISOString(),
      id: row.id,
    }));

    return {
      data: page.data.map((row) => CashSessionsService.present(row)),
      pageInfo: page.pageInfo,
    };
  }

  /** Gün sonu özeti: beklenen tutar, yöntem kırılımı ve hareket dökümü. */
  async summary(principal: Principal, id: string): Promise<CashSessionSummaryDto> {
    const payload = await this.tx.run(async (tx) => {
      const session = await repo.findSessionById(tx, id);
      if (session === undefined) return undefined;
      BranchAccessService.assertMembership(principal, session.branchId);

      const [expectedMinor, byMethod, movements] = await Promise.all([
        repo.expectedCashMinor(tx, id),
        repo.paymentsByMethod(tx, id),
        repo.listMovements(tx, id),
      ]);

      return {
        session: CashSessionsService.present(session),
        expectedMinor,
        byMethod: byMethod.map((row) => ({
          method: row.method as PaymentMethod,
          amountMinor: row.amountMinor,
          count: row.count,
        })),
        movements: movements.map((row) => CashSessionsService.presentMovement(row)),
      };
    });

    if (payload === undefined) throw AppError.notFound('Kasa oturumu bulunamadı');
    return payload;
  }

  static present(row: repo.CashSessionRow): CashSessionResponseDto {
    return {
      id: row.id,
      branchId: row.branchId,
      // Durum TÜRETİLİR; ayrı bir kolon senkron tutulacak ikinci gerçek olurdu.
      status: row.closedAt === null ? 'open' : 'closed',
      openingBalanceMinor: row.openingBalanceMinor,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      expectedMinor: row.expectedMinor,
      countedMinor: row.countedMinor,
      differenceMinor: row.differenceMinor,
      differenceReason: row.differenceReason,
      currency: row.currency,
      version: row.version,
    };
  }

  static presentMovement(row: repo.CashMovementRow): CashMovementDto {
    return {
      id: row.id,
      kind: row.kind,
      amountMinor: row.amountMinor,
      paymentId: row.paymentId,
      refundId: row.refundId,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      const constraint = pgConstraintName(error);
      if (constraint === 'cash_sessions_single_open_key') {
        return AppError.conflict(
          ERROR_CODES.CASH_SESSION_ALREADY_OPEN,
          'Bu şubede zaten açık bir kasa oturumu var',
          { detail: 'Yeni oturum açmadan önce mevcut oturumu kapatın.' },
        );
      }
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Kayıt zaten mevcut');
    }
    if (isPgError(error, PG_ERROR.CASH_SESSION_CLOSED)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Kapanmış kasa oturumu değiştirilemez');
    }
    if (isPgError(error, PG_ERROR.CASH_SESSION_REQUIRED)) {
      return AppError.conflict(
        ERROR_CODES.CASH_SESSION_REQUIRED,
        'Açık bir kasa oturumu gerekli',
      );
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Kasa işlemi geçersiz');
    }
    return error;
  }
}
