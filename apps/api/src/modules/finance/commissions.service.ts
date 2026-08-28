import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { PG_ERROR, isPgError, pgConstraintName } from '../../common/errors/db-errors';
import { DEFAULT_PAGE_SIZE, decodeCursor, toPage } from '../../common/pagination';
import { versionConflict } from '../../common/http/etag';
import {
  commissionAccruals,
  commissionPeriods,
  commissionRules,
} from '../../database/schema';
import { TenantTxService } from '../../database/tenant-tx.service';
import { definedValues } from '../../database/updates';
import type { Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import type {
  CommissionAccrualPageDto,
  CommissionAccrualResponseDto,
  CommissionPeriodResponseDto,
  CommissionReportDto,
  CommissionReportQueryDto,
  CommissionRulePageDto,
  CommissionRuleResponseDto,
  CreateCommissionRuleDto,
  ListAccrualsQueryDto,
  ListCommissionRulesQueryDto,
  ListPeriodsQueryDto,
  UpdateCommissionRuleDto,
} from './dto/commission.dto';

@Injectable()
export class CommissionsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // -------------------------------------------------------------------------
  // Kurallar
  // -------------------------------------------------------------------------
  async createRule(
    principal: Principal,
    input: CreateCommissionRuleDto,
  ): Promise<CommissionRuleResponseDto> {
    const scope = input.scope ?? 'global';
    if ((scope === 'global') !== (input.scopeRefId === undefined)) {
      throw new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Kapsam ile kapsam hedefi uyuşmuyor',
        { detail: "`scope='global'` ise hedef verilmez; aksi hâlde zorunludur." },
      );
    }

    const row = await this.tx
      .run(async (tx) => {
        const [inserted] = await tx
          .insert(commissionRules)
          .values({
            tenantId: principal.tenantId,
            name: input.name,
            scope,
            scopeRefId: input.scopeRefId ?? null,
            staffProfileId: input.staffProfileId ?? null,
            calcKind: input.calcKind,
            value: input.value,
            basis: input.basis ?? 'net_after_discount',
            triggerOn: input.triggerOn ?? 'service_completed',
            priority: input.priority ?? 0,
            effectiveFrom: input.effectiveFrom ?? null,
            effectiveTo: input.effectiveTo ?? null,
          })
          .returning();
        if (inserted === undefined) throw new Error('Prim kuralı yazılamadı');
        return inserted;
      })
      .catch((error: unknown) => {
        throw CommissionsService.translate(error);
      });

    return CommissionsService.presentRule(row);
  }

  async listRules(query: ListCommissionRulesQueryDto): Promise<CommissionRulePageDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);

    const rows = await this.tx.run((tx) => {
      const conditions: SQL[] = [isNull(commissionRules.deletedAt)];
      if (cursor !== undefined) {
        const at = new Date(cursor.sortKey);
        const step = or(
          lt(commissionRules.createdAt, at),
          and(eq(commissionRules.createdAt, at), lt(commissionRules.id, cursor.id)),
        );
        if (step !== undefined) conditions.push(step);
      }
      return tx
        .select()
        .from(commissionRules)
        .where(and(...conditions))
        .orderBy(desc(commissionRules.createdAt), desc(commissionRules.id))
        .limit(limit + 1);
    });

    const page = toPage(rows, limit, (row) => ({
      sortKey: row.createdAt.toISOString(),
      id: row.id,
    }));
    return {
      data: page.data.map((row) => CommissionsService.presentRule(row)),
      pageInfo: page.pageInfo,
    };
  }

  async updateRule(
    id: string,
    expectedVersion: number,
    input: UpdateCommissionRuleDto,
  ): Promise<CommissionRuleResponseDto> {
    const row = await this.tx
      .run(async (tx) => {
        const [updated] = await tx
          .update(commissionRules)
          .set(
            definedValues({
              name: input.name,
              value: input.value,
              priority: input.priority,
              effectiveTo: input.effectiveTo,
              isActive: input.isActive,
            }),
          )
          .where(
            and(
              eq(commissionRules.id, id),
              eq(commissionRules.version, expectedVersion),
              isNull(commissionRules.deletedAt),
            ),
          )
          .returning();
        return updated;
      })
      .catch((error: unknown) => {
        throw CommissionsService.translate(error);
      });

    if (row === undefined) throw await this.missingOrConflict(id);
    return CommissionsService.presentRule(row);
  }

  /**
   * Soft delete.
   *
   * Kural silinmez, pasife alınır: `commission_accruals` satırları ona referans
   * veriyor ve "bu prim hangi kuraldan doğdu" sorusu yıllar sonra da
   * cevaplanabilir olmalı.
   */
  async removeRule(id: string, expectedVersion: number): Promise<void> {
    const row = await this.tx.run(async (tx) => {
      const [updated] = await tx
        .update(commissionRules)
        .set({ deletedAt: new Date(), isActive: false })
        .where(
          and(
            eq(commissionRules.id, id),
            eq(commissionRules.version, expectedVersion),
            isNull(commissionRules.deletedAt),
          ),
        )
        .returning();
      return updated;
    });
    if (row === undefined) throw await this.missingOrConflict(id);
  }

  // -------------------------------------------------------------------------
  // Tahakkuklar ve dönemler
  // -------------------------------------------------------------------------
  async listAccruals(query: ListAccrualsQueryDto): Promise<CommissionAccrualPageDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);

    const rows = await this.tx.run((tx) => {
      const conditions: SQL[] = [];
      if (query.staffProfileId !== undefined) {
        conditions.push(eq(commissionAccruals.staffProfileId, query.staffProfileId));
      }
      if (query.periodId !== undefined) {
        conditions.push(eq(commissionAccruals.periodId, query.periodId));
      }
      if (cursor !== undefined) {
        const at = new Date(cursor.sortKey);
        const step = or(
          lt(commissionAccruals.createdAt, at),
          and(eq(commissionAccruals.createdAt, at), lt(commissionAccruals.id, cursor.id)),
        );
        if (step !== undefined) conditions.push(step);
      }
      return tx
        .select()
        .from(commissionAccruals)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(commissionAccruals.createdAt), desc(commissionAccruals.id))
        .limit(limit + 1);
    });

    const page = toPage(rows, limit, (row) => ({
      sortKey: row.createdAt.toISOString(),
      id: row.id,
    }));
    return {
      data: page.data.map((row) => CommissionsService.presentAccrual(row)),
      pageInfo: page.pageInfo,
    };
  }

  async listPeriods(
    principal: Principal,
    query: ListPeriodsQueryDto,
  ): Promise<CommissionPeriodResponseDto[]> {
    if (query.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, query.branchId);
    }

    const rows = await this.tx.run((tx) => {
      const conditions: SQL[] = [];
      if (query.branchId !== undefined) {
        conditions.push(eq(commissionPeriods.branchId, query.branchId));
      }
      if (query.status !== undefined) {
        conditions.push(sql`${commissionPeriods.status} = ${query.status}`);
      }
      return tx
        .select()
        .from(commissionPeriods)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(commissionPeriods.startsOn));
    });

    return rows.map((row) => CommissionsService.presentPeriod(row));
  }

  /**
   * Dönemi kapatır — KİLİTLER.
   *
   * Kapalı döneme tahakkuk yazılamaz (`K0016`). Kapalı dönemi ilgilendiren bir
   * iptal, cari açık döneme ters kayıt olarak düşer; kapatılmış bir dönemin
   * toplamı bir daha oynamaz.
   */
  async closePeriod(
    principal: Principal,
    id: string,
    expectedVersion: number,
  ): Promise<CommissionPeriodResponseDto> {
    const payload = await this.tx
      .run(async (tx) => {
        const [current] = await tx
          .select()
          .from(commissionPeriods)
          .where(eq(commissionPeriods.id, id))
          .for('update');
        if (current === undefined) return undefined;
        BranchAccessService.assertMembership(principal, current.branchId);
        if (current.status === 'closed') {
          throw AppError.conflict(ERROR_CODES.PERIOD_CLOSED, 'Prim dönemi zaten kapalı');
        }

        const [updated] = await tx
          .update(commissionPeriods)
          .set({ status: 'closed', closedAt: new Date(), closedBy: principal.userId })
          .where(
            and(
              eq(commissionPeriods.id, id),
              eq(commissionPeriods.version, expectedVersion),
            ),
          )
          .returning();
        if (updated === undefined) return { conflict: true as const };
        return updated;
      })
      .catch((error: unknown) => {
        throw CommissionsService.translate(error);
      });

    if (payload === undefined) throw AppError.notFound('Prim dönemi bulunamadı');
    if ('conflict' in payload) throw versionConflict();
    return CommissionsService.presentPeriod(payload);
  }

  /**
   * Personel × dönem prim özeti.
   *
   * Ters kayıtlar negatif olduğu için toplam doğrudan NET primi verir; ayrıca
   * "iptal edilenleri çıkar" adımı yoktur.
   */
  async report(
    principal: Principal,
    query: CommissionReportQueryDto,
  ): Promise<CommissionReportDto> {
    if (query.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, query.branchId);
    }

    const result = await this.tx.run((tx) =>
      tx.execute<{
        staff_profile_id: string;
        staff_name: string | null;
        amount_minor: string | number;
        accrual_count: string | number;
      }>(sql`
        select a.staff_profile_id,
               u.full_name as staff_name,
               coalesce(sum(a.amount_minor), 0)::bigint as amount_minor,
               count(*)::int as accrual_count
          from commission_accruals a
          join staff_profiles sp on sp.id = a.staff_profile_id
          left join users u on u.id = sp.user_id
         where (${query.periodId ?? null}::uuid is null
                or a.period_id = ${query.periodId ?? null}::uuid)
           and (${query.branchId ?? null}::uuid is null
                or a.branch_id = ${query.branchId ?? null}::uuid)
           and (${query.from ?? null}::date is null
                or a.created_at >= ${query.from ?? null}::date)
           and (${query.to ?? null}::date is null
                or a.created_at < ${query.to ?? null}::date)
         group by a.staff_profile_id, u.full_name
         order by amount_minor desc, a.staff_profile_id
      `),
    );

    const rows = result.rows.map((row) => ({
      staffProfileId: row.staff_profile_id,
      staffName: row.staff_name ?? '—',
      amountMinor: Number(row.amount_minor),
      accrualCount: Number(row.accrual_count),
    }));

    return {
      rows,
      totalMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
      currency: 'TRY',
    };
  }

  private async missingOrConflict(id: string): Promise<AppError> {
    const exists = await this.tx.run((tx) =>
      tx.select().from(commissionRules).where(eq(commissionRules.id, id)),
    );
    return exists.length === 0 ? AppError.notFound('Prim kuralı bulunamadı') : versionConflict();
  }

  static presentRule(row: typeof commissionRules.$inferSelect): CommissionRuleResponseDto {
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      scopeRefId: row.scopeRefId,
      staffProfileId: row.staffProfileId,
      calcKind: row.calcKind,
      value: row.value,
      basis: row.basis,
      triggerOn: row.triggerOn,
      priority: row.priority,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      isActive: row.isActive,
      version: row.version,
    };
  }

  static presentAccrual(
    row: typeof commissionAccruals.$inferSelect,
  ): CommissionAccrualResponseDto {
    return {
      id: row.id,
      staffProfileId: row.staffProfileId,
      periodId: row.periodId,
      triggerOn: row.triggerOn,
      ruleBasis: row.ruleBasis,
      basisMinor: row.basisMinor,
      amountMinor: row.amountMinor,
      chargeId: row.chargeId,
      paymentId: row.paymentId,
      reversesAccrualId: row.reversesAccrualId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static presentPeriod(
    row: typeof commissionPeriods.$inferSelect,
  ): CommissionPeriodResponseDto {
    return {
      id: row.id,
      branchId: row.branchId,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: row.status,
      closedAt: row.closedAt?.toISOString() ?? null,
      version: row.version,
    };
  }

  static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.COMMISSION_PERIOD_CLOSED)) {
      return AppError.conflict(
        ERROR_CODES.PERIOD_CLOSED,
        'Kapatılmış prim dönemi değiştirilemez',
        { detail: 'Düzeltme cari açık döneme ters kayıt olarak yazılır.' },
      );
    }
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      const constraint = pgConstraintName(error);
      if (constraint === 'commission_rules_resolution_key') {
        return AppError.conflict(
          ERROR_CODES.CONFLICT,
          'Aynı kapsam ve öncelikte başka bir aktif kural var',
          {
            detail:
              'Kural çözümü belirsiz olamaz; farklı bir öncelik verin ya da ' +
              'mevcut kuralı pasife alın.',
          },
        );
      }
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Kayıt zaten mevcut');
    }
    if (isPgError(error, PG_ERROR.RESTRICT_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Prim tahakkuku değiştirilemez');
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Prim kuralı geçersiz', {
        detail:
          "`collected_amount` matrahı yalnız `payment_received` tetikleyicisiyle kullanılabilir.",
      });
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Personel ya da kapsam bulunamadı');
    }
    return error;
  }
}
