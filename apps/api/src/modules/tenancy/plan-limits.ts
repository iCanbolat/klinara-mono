import { and, count, eq, isNull, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PLANS,
  effectivePlanLimits,
  isPlanKey,
  DEFAULT_PLAN_KEY,
  type ErrorCode,
  type PlanKey,
  type PlanLimits,
  type PlanUsage,
  type TenantPlanInfo,
} from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { branches, staffProfiles, tenants } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

/**
 * Plan kapasite limitleri (şube, hekim/uygulayıcı).
 *
 * Kurallar:
 *   - Limit yalnız YENİ eklemede ve pasiften aktife almada uygulanır. Limitin
 *     üstünde kalmış bir kiracının mevcut şube/hekimleri çalışmaya devam eder.
 *   - Sayım ile yazım aynı transaction'dadır ve kiracı başına bir advisory
 *     lock ile sıralanır: iki eşzamanlı istek ikisi de "limitin altında"
 *     görüp limiti birlikte aşamaz.
 */

interface PlanState {
  planKey: PlanKey;
  limits: PlanLimits;
}

async function loadPlanState(tx: Tx, tenantId: string): Promise<PlanState> {
  const [row] = await tx
    .select({
      planKey: tenants.planKey,
      maxBranchesOverride: tenants.maxBranchesOverride,
      maxPractitionersOverride: tenants.maxPractitionersOverride,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (row === undefined) throw AppError.notFound('Kiracı bulunamadı');
  return {
    planKey: isPlanKey(row.planKey) ? row.planKey : DEFAULT_PLAN_KEY,
    limits: effectivePlanLimits(row),
  };
}

export async function countPlanUsage(tx: Tx, tenantId: string): Promise<PlanUsage> {
  const [branchRow] = await tx
    .select({ n: count() })
    .from(branches)
    .where(
      and(eq(branches.tenantId, tenantId), eq(branches.isActive, true), isNull(branches.deletedAt)),
    );
  const [staffRow] = await tx
    .select({ n: count() })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.tenantId, tenantId),
        eq(staffProfiles.isActive, true),
        isNull(staffProfiles.deletedAt),
      ),
    );
  return { branches: branchRow?.n ?? 0, practitioners: staffRow?.n ?? 0 };
}

export async function getTenantPlanInfo(tx: Tx, tenantId: string): Promise<TenantPlanInfo> {
  const [state, usage] = await Promise.all([
    loadPlanState(tx, tenantId),
    countPlanUsage(tx, tenantId),
  ]);
  return {
    planKey: state.planKey,
    planName: PLANS[state.planKey].name,
    limits: state.limits,
    usage,
  };
}

async function lockTenantPlan(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`plan:${tenantId}`}, 0))`);
}

function limitError(
  code: ErrorCode,
  title: string,
  detail: string,
  extra: Record<string, unknown>,
): AppError {
  return new AppError(409, code, title, { detail, extra });
}

/** Bir şube daha aktif olabilir mi? Değilse 409 `PLAN_BRANCH_LIMIT_REACHED`. */
export async function assertCanAddBranch(tx: Tx, tenantId: string): Promise<void> {
  await lockTenantPlan(tx, tenantId);
  const [state, usage] = await Promise.all([
    loadPlanState(tx, tenantId),
    countPlanUsage(tx, tenantId),
  ]);
  if (usage.branches >= state.limits.maxBranches) {
    throw limitError(
      ERROR_CODES.PLAN_BRANCH_LIMIT_REACHED,
      'Plan şube sınırına ulaşıldı',
      `${PLANS[state.planKey].name} planı en fazla ${state.limits.maxBranches} aktif şubeye izin veriyor.`,
      { limit: state.limits.maxBranches, used: usage.branches, planKey: state.planKey },
    );
  }
}

/** Bir hekim/uygulayıcı daha aktif olabilir mi? Değilse 409 `PLAN_PRACTITIONER_LIMIT_REACHED`. */
export async function assertCanAddPractitioner(tx: Tx, tenantId: string): Promise<void> {
  await lockTenantPlan(tx, tenantId);
  const [state, usage] = await Promise.all([
    loadPlanState(tx, tenantId),
    countPlanUsage(tx, tenantId),
  ]);
  if (usage.practitioners >= state.limits.maxPractitioners) {
    throw limitError(
      ERROR_CODES.PLAN_PRACTITIONER_LIMIT_REACHED,
      'Plan hekim sınırına ulaşıldı',
      `${PLANS[state.planKey].name} planı en fazla ${state.limits.maxPractitioners} aktif hekim/uygulayıcıya izin veriyor.`,
      { limit: state.limits.maxPractitioners, used: usage.practitioners, planKey: state.planKey },
    );
  }
}
