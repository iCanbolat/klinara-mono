import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { branchHours, holidays, scheduleExceptions, staffSchedules } from '../../database/schema';
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

// ---------------------------------------------------------------------------
// Tatiller
// ---------------------------------------------------------------------------

export type HolidayRow = typeof holidays.$inferSelect;

/**
 * Şube süzgeci verildiğinde kiracı geneli satırlar da döner.
 *
 * Uygunluk motoru (`availability.repository.ts`) o günü hesaplarken ikisine
 * birden bakıyor ve şube satırını tercih ediyor; liste yalnız şube satırlarını
 * döndürseydi ekran, takvimi fiilen kapatan bir kaydı hiç göstermezdi.
 */
export async function listHolidays(
  tx: Tx,
  filters: { branchId?: string | undefined; from?: string | undefined; to?: string | undefined },
): Promise<HolidayRow[]> {
  return tx
    .select()
    .from(holidays)
    .where(
      and(
        isNull(holidays.deletedAt),
        filters.branchId !== undefined
          ? or(eq(holidays.branchId, filters.branchId), isNull(holidays.branchId))
          : undefined,
        filters.from !== undefined ? gte(holidays.holidayDate, filters.from) : undefined,
        filters.to !== undefined ? lte(holidays.holidayDate, filters.to) : undefined,
      ),
    )
    .orderBy(holidays.holidayDate, holidays.branchId);
}

export async function findHolidayById(tx: Tx, id: string): Promise<HolidayRow | undefined> {
  const [row] = await tx
    .select()
    .from(holidays)
    .where(and(eq(holidays.id, id), isNull(holidays.deletedAt)))
    .limit(1);
  return row;
}

export async function insertHoliday(
  tx: Tx,
  tenantId: string,
  input: {
    branchId?: string | undefined;
    holidayDate: string;
    name: string;
    isClosed: boolean;
    openTime?: string | undefined;
    closeTime?: string | undefined;
  },
): Promise<HolidayRow> {
  const [row] = await tx
    .insert(holidays)
    .values({
      tenantId,
      branchId: input.branchId ?? null,
      holidayDate: input.holidayDate,
      name: input.name.trim(),
      isClosed: input.isClosed,
      openTime: input.openTime,
      closeTime: input.closeTime,
    })
    .returning();

  if (row === undefined) throw new Error('Tatil kaydı oluşturulamadı');
  return row;
}

/**
 * `openTime`/`closeTime` HER ZAMAN yazılır, `definedValues` ile süzülmez.
 *
 * "Yarım günü tam kapalıya çevir" isteği `isClosed: true` ile gelir ve saatler
 * gövdede olmaz; süzülselerdi eski saatler satırda kalır ve `holidays_time_window`
 * check constraint'i isteği anlamsız bir 500 ile reddederdi. Servis iki alanı
 * birlikte çözüp buraya tam hâlini veriyor.
 */
export async function updateHoliday(
  tx: Tx,
  id: string,
  values: { name?: string | undefined; isClosed: boolean; openTime: string | null; closeTime: string | null },
): Promise<HolidayRow | undefined> {
  const [row] = await tx
    .update(holidays)
    .set({
      ...(values.name !== undefined ? { name: values.name } : {}),
      isClosed: values.isClosed,
      openTime: values.openTime,
      closeTime: values.closeTime,
    })
    .where(and(eq(holidays.id, id), isNull(holidays.deletedAt)))
    .returning();
  return row;
}

export async function softDeleteHoliday(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(holidays)
    .set({ deletedAt: new Date() })
    .where(and(eq(holidays.id, id), isNull(holidays.deletedAt)))
    .returning({ id: holidays.id });
  return rows.length > 0;
}
