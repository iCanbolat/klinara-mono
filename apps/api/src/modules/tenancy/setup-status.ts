import { and, count, eq, isNull } from 'drizzle-orm';
import type { SetupStepKey, TenantSetupStatus } from '@klinara/shared';
import {
  bookingSites,
  branches,
  branchHours,
  services,
  staffProfiles,
  staffServices,
  whatsappAccounts,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

/**
 * Elden kurulum kontrol listesi.
 *
 * Klinik paneli (karşılama kartı) ve platform ekranı (kiracı detayı) aynı
 * hesabı kullanır. Her madde "en az bir tane var mı" sorusudur; kalite
 * kontrolü değil, kurulumun nerede kaldığının göstergesi.
 */
export async function getSetupStatus(tx: Tx, tenantId: string): Promise<TenantSetupStatus> {
  const has = async (query: Promise<{ n: number }[]>): Promise<boolean> =>
    ((await query)[0]?.n ?? 0) > 0;

  const branch = await has(
    tx
      .select({ n: count() })
      .from(branches)
      .where(
        and(
          eq(branches.tenantId, tenantId),
          eq(branches.isActive, true),
          isNull(branches.deletedAt),
        ),
      ),
  );
  const hours = await has(
    tx
      .select({ n: count() })
      .from(branchHours)
      .where(
        and(
          eq(branchHours.tenantId, tenantId),
          eq(branchHours.isClosed, false),
          isNull(branchHours.deletedAt),
        ),
      ),
  );
  const service = await has(
    tx
      .select({ n: count() })
      .from(services)
      .where(
        and(
          eq(services.tenantId, tenantId),
          eq(services.isActive, true),
          isNull(services.deletedAt),
        ),
      ),
  );
  // Randevu alınabilmesi için hekimin en az bir hizmete yetkin olması gerekir.
  const practitioner = await has(
    tx
      .select({ n: count() })
      .from(staffServices)
      .innerJoin(staffProfiles, eq(staffProfiles.id, staffServices.staffProfileId))
      .where(
        and(
          eq(staffServices.tenantId, tenantId),
          eq(staffServices.isActive, true),
          isNull(staffServices.deletedAt),
          eq(staffProfiles.isActive, true),
          isNull(staffProfiles.deletedAt),
        ),
      ),
  );
  const whatsapp = await has(
    tx
      .select({ n: count() })
      .from(whatsappAccounts)
      .where(and(eq(whatsappAccounts.tenantId, tenantId), eq(whatsappAccounts.status, 'active'))),
  );
  const bookingPage = await has(
    tx
      .select({ n: count() })
      .from(bookingSites)
      .where(
        and(
          eq(bookingSites.tenantId, tenantId),
          eq(bookingSites.status, 'published'),
          isNull(bookingSites.deletedAt),
        ),
      ),
  );

  const done: Record<SetupStepKey, boolean> = {
    branch,
    hours,
    services: service,
    practitioners: practitioner,
    whatsapp,
    bookingPage,
  };
  const steps = (Object.keys(done) as SetupStepKey[]).map((key) => ({ key, done: done[key] }));
  return { steps, complete: steps.every((step) => step.done) };
}
