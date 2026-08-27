import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { TenantTxService } from '../../database/tenant-tx.service';
import { AvailabilityCacheService } from '../booking/availability-cache.service';
import type { Principal } from '../identity/principal';
import { canAccessBranch } from '../identity/principal';
import * as repo from './scheduling.repository';
import type {
  BranchHourInputDto,
  BranchHourResponseDto,
  BranchHoursResponseDto,
  ListScheduleExceptionsQueryDto,
  PutBranchHoursDto,
  PutStaffScheduleDto,
  ScheduleExceptionInputDto,
  ScheduleExceptionResponseDto,
  StaffScheduleByBranchResponseDto,
  StaffScheduleInputDto,
  StaffScheduleResponseDto,
} from './dto/scheduling.dto';

@Injectable()
export class SchedulingService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly availabilityCache: AvailabilityCacheService,
  ) {}

  /**
   * Çalışma saati, şablon ve istisna değişimleri uygunluğun TANIMINI
   * değiştirir; cache onsuz eski takvimi göstermeye devam ederdi.
   */
  private invalidateAvailability(): void {
    this.availabilityCache.invalidateTenant(this.tx.tenantId);
  }

  async getBranchHours(principal: Principal, branchId: string): Promise<BranchHoursResponseDto> {
    SchedulingService.assertBranchAccess(principal, branchId);

    const rows = await this.tx.run((tx) => repo.listBranchHours(tx, branchId));
    return {
      branchId,
      entries: rows.map((row) => SchedulingService.toBranchHourResponse(row)),
    };
  }

  async replaceBranchHours(
    principal: Principal,
    branchId: string,
    input: PutBranchHoursDto,
  ): Promise<BranchHoursResponseDto> {
    SchedulingService.assertBranchAccess(principal, branchId);
    SchedulingService.assertBranchHourEntries(input.entries);

    const rows = await this.tx
      .run(async (tx) => {
        await repo.replaceBranchHours(tx, this.tx.tenantId, branchId, input.entries);
        return repo.listBranchHours(tx, branchId);
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Şube bulunamadı');
        }
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Şube bu kiracıya ait değil');
        }
        throw error;
      });

    this.invalidateAvailability();

    return {
      branchId,
      entries: rows.map((row) => SchedulingService.toBranchHourResponse(row)),
    };
  }

  async getStaffSchedule(
    principal: Principal,
    staffProfileId: string,
    branchId: string,
  ): Promise<StaffScheduleByBranchResponseDto> {
    SchedulingService.assertBranchAccess(principal, branchId);

    const rows = await this.tx.run((tx) => repo.listStaffSchedule(tx, staffProfileId, branchId));
    return {
      staffProfileId,
      branchId,
      entries: rows.map((row) => SchedulingService.toStaffScheduleResponse(row)),
    };
  }

  async replaceStaffSchedule(
    principal: Principal,
    staffProfileId: string,
    input: PutStaffScheduleDto,
  ): Promise<StaffScheduleByBranchResponseDto> {
    SchedulingService.assertBranchAccess(principal, input.branchId);
    SchedulingService.assertStaffScheduleEntries(input.entries);

    const rows = await this.tx
      .run(async (tx) => {
        await repo.replaceStaffSchedule(
          tx,
          this.tx.tenantId,
          staffProfileId,
          input.branchId,
          input.entries,
        );
        return repo.listStaffSchedule(tx, staffProfileId, input.branchId);
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Personel profili veya şube bulunamadı');
        }
        // Kapsam trigger'ı: FK doğrulaması RLS'i bypass ettiği için BAŞKA bir
        // kiracının profil/şube kimliği FK'dan geçer, kurala trigger'da takılır.
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Personel profili ve şube bu kiracıya ait olmalı',
          );
        }
        throw error;
      });

    this.invalidateAvailability();

    return {
      staffProfileId,
      branchId: input.branchId,
      entries: rows.map((row) => SchedulingService.toStaffScheduleResponse(row)),
    };
  }

  async listScheduleExceptions(
    principal: Principal,
    query: ListScheduleExceptionsQueryDto,
  ): Promise<ScheduleExceptionResponseDto[]> {
    SchedulingService.assertBranchAccess(principal, query.branchId);

    const filters: {
      branchId: string;
      staffProfileId?: string;
      from?: Date;
      to?: Date;
    } = { branchId: query.branchId };

    if (query.staffProfileId !== undefined) filters.staffProfileId = query.staffProfileId;
    if (query.from !== undefined) filters.from = new Date(query.from);
    if (query.to !== undefined) filters.to = new Date(query.to);

    const rows = await this.tx.run((tx) => repo.listScheduleExceptions(tx, filters));

    return rows.map((row) => SchedulingService.toScheduleExceptionResponse(row));
  }

  async createScheduleException(
    principal: Principal,
    input: ScheduleExceptionInputDto,
  ): Promise<ScheduleExceptionResponseDto> {
    SchedulingService.assertBranchAccess(principal, input.branchId);
    SchedulingService.assertExceptionInput(input);

    const row = await this.tx
      .run((tx) => repo.insertScheduleException(tx, this.tx.tenantId, input))
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Personel profili veya şube bulunamadı');
        }
        // Kapsam trigger'ı: FK doğrulaması RLS'i bypass ettiği için BAŞKA bir
        // kiracının profil/şube kimliği FK'dan geçer, kurala trigger'da takılır.
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Personel profili ve şube bu kiracıya ait olmalı',
          );
        }
        throw error;
      });

    this.invalidateAvailability();
    return SchedulingService.toScheduleExceptionResponse(row);
  }

  async deleteScheduleException(principal: Principal, id: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const current = await repo.findScheduleExceptionById(tx, id);
      if (current === undefined) throw AppError.notFound('İstisna kaydı bulunamadı');
      SchedulingService.assertBranchAccess(principal, current.branchId);

      const updated = await repo.deactivateScheduleException(tx, id);
      if (updated === undefined) throw AppError.notFound('İstisna kaydı bulunamadı');
    });

    this.invalidateAvailability();
  }

  private static assertBranchAccess(principal: Principal, branchId: string): void {
    if (!canAccessBranch(principal, branchId)) {
      throw new AppError(403, ERROR_CODES.BRANCH_FORBIDDEN, 'Bu şubede yetkiniz yok');
    }
  }

  private static assertBranchHourEntries(entries: BranchHourInputDto[]): void {
    SchedulingService.assertWeeklyUniqueDays(
      entries.map((entry) => entry.dayOfWeek),
      'Şube çalışma saatleri her gün için bir kayıt içermelidir',
    );

    for (const entry of entries) {
      const isClosed = entry.isClosed ?? false;
      if (isClosed) {
        if (
          entry.openTime !== undefined ||
          entry.closeTime !== undefined ||
          entry.breakStartTime !== undefined ||
          entry.breakEndTime !== undefined
        ) {
          throw new AppError(
            400,
            ERROR_CODES.VALIDATION_FAILED,
            'Kapalı gün için saat aralığı gönderilemez',
          );
        }
        continue;
      }

      if (entry.openTime === undefined || entry.closeTime === undefined) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Açık günlerde openTime ve closeTime zorunludur',
        );
      }

      if (
        (entry.breakStartTime === undefined) !== (entry.breakEndTime === undefined)
      ) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Mola aralığında başlangıç ve bitiş birlikte verilmelidir',
        );
      }
    }
  }

  private static assertStaffScheduleEntries(entries: StaffScheduleInputDto[]): void {
    SchedulingService.assertWeeklyUniqueDays(
      entries.map((entry) => entry.dayOfWeek),
      'Personel haftalık şablonu her gün için bir kayıt içermelidir',
    );

    for (const entry of entries) {
      const isOff = entry.isOff ?? false;
      if (isOff) {
        if (entry.startTime !== undefined || entry.endTime !== undefined) {
          throw new AppError(
            400,
            ERROR_CODES.VALIDATION_FAILED,
            'İzinli gün için saat aralığı gönderilemez',
          );
        }
        continue;
      }

      if (entry.startTime === undefined || entry.endTime === undefined) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Çalışılan günlerde startTime ve endTime zorunludur',
        );
      }
    }
  }

  private static assertWeeklyUniqueDays(days: number[], message: string): void {
    if (days.length !== 7) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, message);
    }
    const unique = new Set(days);
    if (unique.size !== 7) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, message);
    }
    for (const day of unique) {
      if (day < 0 || day > 6) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, message);
      }
    }
  }

  private static assertExceptionInput(input: ScheduleExceptionInputDto): void {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'İstisna bitişi başlangıçtan sonra olmalıdır',
      );
    }

    const recurrenceType = input.recurrenceType ?? 'none';
    if (recurrenceType === 'none') {
      if (input.recurrenceUntil !== undefined) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Tek seferlik kayıtta recurrenceUntil gönderilemez',
        );
      }
      if ((input.recurrenceWeekdays ?? []).length > 0) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Tek seferlik kayıtta recurrenceWeekdays gönderilemez',
        );
      }
      return;
    }

    if (input.recurrenceUntil === undefined) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Weekly recurrence için recurrenceUntil zorunludur',
      );
    }

    const weekdays = input.recurrenceWeekdays ?? [];
    if (weekdays.length === 0) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Weekly recurrence için en az bir gün seçilmelidir',
      );
    }
  }

  private static toBranchHourResponse(row: repo.BranchHourRow): BranchHourResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      branchId: row.branchId,
      dayOfWeek: row.dayOfWeek,
      isClosed: row.isClosed,
      openTime: row.openTime,
      closeTime: row.closeTime,
      breakStartTime: row.breakStartTime,
      breakEndTime: row.breakEndTime,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private static toStaffScheduleResponse(row: repo.StaffScheduleRow): StaffScheduleResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      staffProfileId: row.staffProfileId,
      branchId: row.branchId,
      dayOfWeek: row.dayOfWeek,
      isOff: row.isOff,
      startTime: row.startTime,
      endTime: row.endTime,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private static toScheduleExceptionResponse(
    row: repo.ScheduleExceptionRow,
  ): ScheduleExceptionResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      staffProfileId: row.staffProfileId,
      branchId: row.branchId,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      reason: row.reason,
      recurrenceType: row.recurrenceType,
      recurrenceIntervalWeeks: row.recurrenceIntervalWeeks,
      recurrenceUntil: row.recurrenceUntil?.toISOString() ?? null,
      recurrenceWeekdays: row.recurrenceWeekdays,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
