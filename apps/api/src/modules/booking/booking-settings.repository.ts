import { and, eq, isNull } from 'drizzle-orm';
import { branches, tenantSettings } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export interface BookingSettings {
  slotGranularityMinutes: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
  preventCustomerDoubleBooking: boolean;
  cancelWindowHours: number;
}

/**
 * Takvim motorunun ihtiyaç duyduğu kiracı ayarları.
 *
 * Tenancy modülünün repository'sine uzanmak yerine dar bir okuma: bu modül
 * ayarların YAZILMASINA hiçbir şekilde karışmaz, yalnız kural parametrelerini
 * okur.
 */
export async function getBookingSettings(
  tx: Tx,
  tenantId: string,
): Promise<BookingSettings | undefined> {
  const [row] = await tx
    .select({
      slotGranularityMinutes: tenantSettings.slotGranularityMinutes,
      minLeadMinutes: tenantSettings.minLeadMinutes,
      maxAdvanceDays: tenantSettings.maxAdvanceDays,
      preventCustomerDoubleBooking: tenantSettings.preventCustomerDoubleBooking,
      cancelWindowHours: tenantSettings.cancelWindowHours,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);
  return row;
}

export interface BookingBranch {
  id: string;
  timezone: string;
}

export async function findBranchForBooking(
  tx: Tx,
  branchId: string,
): Promise<BookingBranch | undefined> {
  const [row] = await tx
    .select({ id: branches.id, timezone: branches.timezone })
    .from(branches)
    .where(and(eq(branches.id, branchId), isNull(branches.deletedAt), eq(branches.isActive, true)))
    .limit(1);
  return row;
}
