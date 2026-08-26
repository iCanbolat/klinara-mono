import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { branchHours, scheduleExceptions, staffSchedules } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import type {
  BranchHourInputDto,
  ScheduleExceptionInputDto,
  StaffScheduleInputDto,
} from './dto/scheduling.dto';

export type BranchHourRow = typeof branchHours.$inferSelect;
export type StaffScheduleRow = typeof staffSchedules.$inferSelect;
export type ScheduleExceptionRow = typeof scheduleExceptions.$inferSelect;

export async function listBranchHours(tx: Tx, branchId: string): Promise<BranchHourRow[]> {
  return tx
    .select()
    .from(branchHours)
    .where(and(eq(branchHours.branchId, branchId), isNull(branchHours.deletedAt)))
    .orderBy(branchHours.dayOfWeek);
}

export async function replaceBranchHours(
  tx: Tx,
  tenantId: string,
  branchId: string,
  entries: BranchHourInputDto[],
): Promise<void> {
  await tx.delete(branchHours).where(eq(branchHours.branchId, branchId));
  if (entries.length === 0) return;

  await tx.insert(branchHours).values(
    entries.map((entry) => ({
      tenantId,
      branchId,
      dayOfWeek: entry.dayOfWeek,
      isClosed: entry.isClosed ?? false,
      openTime: entry.openTime,
      closeTime: entry.closeTime,
      breakStartTime: entry.breakStartTime,
      breakEndTime: entry.breakEndTime,
    })),
  );
}

export async function listStaffSchedule(
  tx: Tx,
  staffProfileId: string,
  branchId: string,
): Promise<StaffScheduleRow[]> {
  return tx
    .select()
    .from(staffSchedules)
    .where(
      and(
        eq(staffSchedules.staffProfileId, staffProfileId),
        eq(staffSchedules.branchId, branchId),
        isNull(staffSchedules.deletedAt),
      ),
    )
    .orderBy(staffSchedules.dayOfWeek);
}

export async function replaceStaffSchedule(
  tx: Tx,
  tenantId: string,
  staffProfileId: string,
  branchId: string,
  entries: StaffScheduleInputDto[],
): Promise<void> {
  await tx
    .delete(staffSchedules)
    .where(and(eq(staffSchedules.staffProfileId, staffProfileId), eq(staffSchedules.branchId, branchId)));

  if (entries.length === 0) return;

  await tx.insert(staffSchedules).values(
    entries.map((entry) => ({
      tenantId,
      staffProfileId,
      branchId,
      dayOfWeek: entry.dayOfWeek,
      isOff: entry.isOff ?? false,
      startTime: entry.startTime,
      endTime: entry.endTime,
    })),
  );
}

export async function listScheduleExceptions(
  tx: Tx,
  filters: {
    branchId: string;
    staffProfileId?: string;
    from?: Date;
    to?: Date;
  },
): Promise<ScheduleExceptionRow[]> {
  return tx
    .select()
    .from(scheduleExceptions)
    .where(
      and(
        eq(scheduleExceptions.branchId, filters.branchId),
        isNull(scheduleExceptions.deletedAt),
        filters.staffProfileId !== undefined
          ? eq(scheduleExceptions.staffProfileId, filters.staffProfileId)
          : undefined,
        filters.from !== undefined ? gte(scheduleExceptions.startsAt, filters.from) : undefined,
        filters.to !== undefined ? lte(scheduleExceptions.startsAt, filters.to) : undefined,
      ),
    )
    .orderBy(scheduleExceptions.startsAt);
}

export async function insertScheduleException(
  tx: Tx,
  tenantId: string,
  input: ScheduleExceptionInputDto,
): Promise<ScheduleExceptionRow> {
  const [row] = await tx
    .insert(scheduleExceptions)
    .values({
      tenantId,
      staffProfileId: input.staffProfileId,
      branchId: input.branchId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      reason: input.reason,
      recurrenceType: input.recurrenceType ?? 'none',
      recurrenceIntervalWeeks: input.recurrenceIntervalWeeks ?? 1,
      recurrenceUntil: input.recurrenceUntil !== undefined ? new Date(input.recurrenceUntil) : undefined,
      recurrenceWeekdays: input.recurrenceWeekdays ?? [],
      isActive: input.isActive ?? true,
    })
    .returning();

  if (row === undefined) throw new Error('İstisna kaydı oluşturulamadı');
  return row;
}

export async function findScheduleExceptionById(
  tx: Tx,
  id: string,
): Promise<ScheduleExceptionRow | undefined> {
  const [row] = await tx
    .select()
    .from(scheduleExceptions)
    .where(and(eq(scheduleExceptions.id, id), isNull(scheduleExceptions.deletedAt)))
    .limit(1);
  return row;
}

export async function deactivateScheduleException(
  tx: Tx,
  id: string,
): Promise<ScheduleExceptionRow | undefined> {
  const [row] = await tx
    .update(scheduleExceptions)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(scheduleExceptions.id, id))
    .returning();
  return row;
}
