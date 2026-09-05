import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PERMISSIONS } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import { hasPermission, type Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import { branchUniverse, needsOwnScope, type ReportScope } from './report-scope';

/**
 * Bir rapor isteğinin kapsamını çözer — daraltmanın TEK yeri.
 *
 * Her rapor servisinin kendi `if (izin yoksa …)` satırını yazması, altı ucun
 * altı ayrı yorumu demekti; biri unutulduğunda da hata sessiz olurdu: rapor
 * çalışır, yalnız fazla veri döner.
 */
@Injectable()
export class ReportScopeService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branches: BranchAccessService,
  ) {}

  async resolve(
    principal: Principal,
    requestedBranchId?: string,
    requestedStaffProfileId?: string,
  ): Promise<ReportScope> {
    if (requestedBranchId !== undefined) {
      await this.branches.assertInput(principal, requestedBranchId);
    }

    const own = needsOwnScope(principal);
    const staffProfileId = own
      ? await this.ownStaffProfileId(principal)
      : (requestedStaffProfileId ?? null);

    return {
      branchIds: branchUniverse(principal, requestedBranchId),
      staffProfileId,
      kind: own ? 'own' : 'all',
      showMoney:
        hasPermission(principal, PERMISSIONS.REPORT_REVENUE_READ) ||
        hasPermission(principal, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN),
    };
  }

  /**
   * Çağıranın kendi personel profili.
   *
   * `staff_profiles (tenant_id, user_id)` tekil olduğu için tek satır döner.
   * Profili olmayan bir kullanıcı `report.performance:read.own` taşıyorsa rol
   * yapılandırması eksiktir; boş rapor dönmek yerine `403` veriyoruz — boş bir
   * rapor "bu ay hiç iş yapmadın" gibi okunur ve yanlış olur.
   */
  private async ownStaffProfileId(principal: Principal): Promise<string> {
    const found = await this.tx.run(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        select sp.id
          from staff_profiles sp
         where sp.user_id = ${principal.userId}::uuid
           and sp.deleted_at is null
         limit 1
      `);
      return result.rows[0]?.id ?? null;
    });

    if (found === null) {
      throw AppError.forbidden(
        'Bu hesap bir personel profiline bağlı değil; kendi performans raporu üretilemez.',
      );
    }
    return found;
  }
}
