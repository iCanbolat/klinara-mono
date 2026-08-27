import { and, eq, inArray, isNull } from 'drizzle-orm';
import { staffProfiles, staffServices, users } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, hasUpdates, type Updatable } from '../../database/updates';
import type { StaffServiceInputDto } from './dto/staff.dto';


export type StaffProfileRow = typeof staffProfiles.$inferSelect;
export type StaffServiceRow = typeof staffServices.$inferSelect;

export interface StaffProfileWithUser {
  id: string;
  tenantId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  primaryBranchId: string | null;
  title: string | null;
  specialties: string[];
  calendarColor: string | null;
  bio: string | null;
  isVisibleOnline: boolean;
  isActive: boolean;
  createdAt: Date;
}

export async function listStaffProfiles(tx: Tx): Promise<StaffProfileWithUser[]> {
  return tx
    .select({
      id: staffProfiles.id,
      tenantId: staffProfiles.tenantId,
      userId: staffProfiles.userId,
      userFullName: users.fullName,
      userEmail: users.email,
      primaryBranchId: staffProfiles.primaryBranchId,
      title: staffProfiles.title,
      specialties: staffProfiles.specialties,
      calendarColor: staffProfiles.calendarColor,
      bio: staffProfiles.bio,
      isVisibleOnline: staffProfiles.isVisibleOnline,
      isActive: staffProfiles.isActive,
      createdAt: staffProfiles.createdAt,
    })
    .from(staffProfiles)
    .innerJoin(users, eq(users.id, staffProfiles.userId))
    .where(and(isNull(staffProfiles.deletedAt), isNull(users.deletedAt)))
    .orderBy(users.fullName);
}

export async function findStaffProfileById(
  tx: Tx,
  id: string,
): Promise<StaffProfileWithUser | undefined> {
  const [row] = await tx
    .select({
      id: staffProfiles.id,
      tenantId: staffProfiles.tenantId,
      userId: staffProfiles.userId,
      userFullName: users.fullName,
      userEmail: users.email,
      primaryBranchId: staffProfiles.primaryBranchId,
      title: staffProfiles.title,
      specialties: staffProfiles.specialties,
      calendarColor: staffProfiles.calendarColor,
      bio: staffProfiles.bio,
      isVisibleOnline: staffProfiles.isVisibleOnline,
      isActive: staffProfiles.isActive,
      createdAt: staffProfiles.createdAt,
    })
    .from(staffProfiles)
    .innerJoin(users, eq(users.id, staffProfiles.userId))
    .where(and(eq(staffProfiles.id, id), isNull(staffProfiles.deletedAt), isNull(users.deletedAt)))
    .limit(1);
  return row;
}

export async function insertStaffProfile(
  tx: Tx,
  values: {
    tenantId: string;
    userId: string;
    primaryBranchId?: string | null | undefined;
    title?: string | null | undefined;
    specialties: string[];
    calendarColor?: string | null | undefined;
    bio?: string | null | undefined;
    isVisibleOnline: boolean;
    isActive: boolean;
  },
): Promise<StaffProfileRow> {
  const [row] = await tx.insert(staffProfiles).values(values).returning();
  if (row === undefined) throw new Error('Personel profili oluşturulamadı');
  return row;
}

export async function updateStaffProfile(
  tx: Tx,
  id: string,
  values: Updatable<
    Pick<
      StaffProfileRow,
      'primaryBranchId' | 'title' | 'specialties' | 'calendarColor' | 'bio' | 'isVisibleOnline' | 'isActive'
    >
  >,
): Promise<StaffProfileRow | undefined> {
  const patch = definedValues(values);
  if (!hasUpdates(patch)) {
    const [row] = await tx
      .select()
      .from(staffProfiles)
      .where(and(eq(staffProfiles.id, id), isNull(staffProfiles.deletedAt)))
      .limit(1);
    return row;
  }

  const [row] = await tx.update(staffProfiles).set(patch).where(eq(staffProfiles.id, id)).returning();
  return row;
}

export async function listStaffServicesForProfile(
  tx: Tx,
  staffProfileId: string,
): Promise<StaffServiceRow[]> {
  return tx
    .select()
    .from(staffServices)
    .where(
      and(eq(staffServices.staffProfileId, staffProfileId), isNull(staffServices.deletedAt)),
    )
    .orderBy(staffServices.createdAt);
}

export async function listStaffServicesForProfiles(
  tx: Tx,
  profileIds: string[],
): Promise<StaffServiceRow[]> {
  if (profileIds.length === 0) return [];

  return tx
    .select()
    .from(staffServices)
    .where(
      and(inArray(staffServices.staffProfileId, profileIds), isNull(staffServices.deletedAt)),
    );
}

export async function replaceStaffServices(
  tx: Tx,
  tenantId: string,
  staffProfileId: string,
  inputs: StaffServiceInputDto[],
): Promise<void> {
  await tx.delete(staffServices).where(eq(staffServices.staffProfileId, staffProfileId));

  if (inputs.length === 0) return;

  await tx.insert(staffServices).values(
    inputs.map((input) => ({
      tenantId,
      staffProfileId,
      serviceId: input.serviceId,
      branchId: input.branchId,
      customDurationMinutes: input.customDurationMinutes,
      customPriceMinor: input.customPriceMinor,
      isActive: input.isActive ?? true,
    })),
  );
}
