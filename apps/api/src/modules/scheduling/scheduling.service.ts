import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { TenantTxService } from '../../database/tenant-tx.service';
import { AvailabilityCacheService } from '../booking/availability-cache.service';
import type { Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import * as repo from './scheduling.repository';
import type {
  BranchHourInputDto,
  BranchHourResponseDto,
  BranchHoursResponseDto,
  HolidayInputDto,
  HolidayResponseDto,
  ListHolidaysQueryDto,
  ListScheduleExceptionsQueryDto,
  PutBranchHoursDto,
  PutStaffScheduleDto,
  ScheduleExceptionInputDto,
  ScheduleExceptionResponseDto,
  StaffScheduleByBranchResponseDto,
  StaffScheduleInputDto,
  StaffScheduleResponseDto,
  UpdateHolidayDto,
} from './dto/scheduling.dto';

@Injectable()
export class SchedulingService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly availabilityCache: AvailabilityCacheService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  /**
   * Çalışma saati, şablon ve istisna değişimleri uygunluğun TANIMINI
   * değiştirir; cache onsuz eski takvimi göstermeye devam ederdi.
   */
  private invalidateAvailability(): void {
    this.availabilityCache.invalidateTenant(this.tx.tenantId);
  }

  async getBranchHours(principal: Principal, branchId: string): Promise<BranchHoursResponseDto> {
    await this.branchAccess.assertInput(principal, branchId);

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
    await this.branchAccess.assertInput(principal, branchId);
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
    await this.branchAccess.assertInput(principal, branchId);

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
    await this.branchAccess.assertInput(principal, input.branchId);
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
    await this.branchAccess.assertInput(principal, query.branchId);

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
    await this.branchAccess.assertInput(principal, input.branchId);
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
      BranchAccessService.assertMembership(principal, current.branchId);

      const updated = await repo.deactivateScheduleException(tx, id);
      if (updated === undefined) throw AppError.notFound('İstisna kaydı bulunamadı');
    });

    this.invalidateAvailability();
  }

  // -------------------------------------------------------------------------
  // Tatiller
  // -------------------------------------------------------------------------

  async listHolidays(
    principal: Principal,
    query: ListHolidaysQueryDto,
  ): Promise<HolidayResponseDto[]> {
    if (query.branchId !== undefined) await this.branchAccess.assertInput(principal, query.branchId);
    if (query.from !== undefined && query.to !== undefined && query.to < query.from) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'to, from tarihinden önce olamaz');
    }

    const rows = await this.tx.run((tx) =>
      repo.listHolidays(tx, { branchId: query.branchId, from: query.from, to: query.to }),
    );
    return rows.map((row) => SchedulingService.toHolidayResponse(row));
  }

  async createHoliday(
    principal: Principal,
    input: HolidayInputDto,
  ): Promise<HolidayResponseDto> {
    await this.assertHolidayScope(principal, input.branchId ?? null);
    const hours = SchedulingService.resolveHolidayHours(input.isClosed ?? true, input.openTime, input.closeTime);

    const row = await this.tx
      .run((tx) => repo.insertHoliday(tx, this.tx.tenantId, { ...input, ...hours }))
      .catch((error: unknown) => {
        throw SchedulingService.translateHoliday(error);
      });

    this.invalidateAvailability();
    return SchedulingService.toHolidayResponse(row);
  }

  async updateHoliday(
    principal: Principal,
    id: string,
    input: UpdateHolidayDto,
  ): Promise<HolidayResponseDto> {
    const row = await this.tx
      .run(async (tx) => {
        const current = await repo.findHolidayById(tx, id);
        if (current === undefined) return undefined;
        // Kapsam SATIRDAN okunuyor: RLS satırın bu kiracıya ait olduğunu zaten
        // kanıtladı, geriye yalnız "bu kullanıcı bu şubeye dokunabilir mi"
        // sorusu kalıyor.
        SchedulingService.assertHolidayRowScope(principal, current.branchId);

        // Saatler ÜÇ kaynaktan çözülüyor: gövde, mevcut satır ve `isClosed`.
        //
        // Kapalıya çevirme (`isClosed: true`) kayıtlı saatleri TEMİZLER, hata
        // vermez: gövdede saat yok, çelişki de yok. Çelişki yalnız İSTEMCİNİN
        // AÇIKÇA saat gönderdiği durumdadır ve orası 400'dür. Kayıtlı saatleri
        // çelişki saymak, "yarım günü tam kapalıya çevir" isteğini imkânsız
        // kılardı.
        const isClosed = input.isClosed ?? current.isClosed;
        const hours = isClosed
          ? SchedulingService.resolveHolidayHours(true, input.openTime, input.closeTime)
          : SchedulingService.resolveHolidayHours(
              false,
              input.openTime ?? current.openTime ?? undefined,
              input.closeTime ?? current.closeTime ?? undefined,
            );

        return repo.updateHoliday(tx, id, {
          name: input.name?.trim(),
          isClosed,
          openTime: hours.openTime ?? null,
          closeTime: hours.closeTime ?? null,
        });
      })
      .catch((error: unknown) => {
        throw SchedulingService.translateHoliday(error);
      });

    if (row === undefined) throw AppError.notFound('Tatil kaydı bulunamadı');

    this.invalidateAvailability();
    return SchedulingService.toHolidayResponse(row);
  }

  async deleteHoliday(principal: Principal, id: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const current = await repo.findHolidayById(tx, id);
      if (current === undefined) throw AppError.notFound('Tatil kaydı bulunamadı');
      SchedulingService.assertHolidayRowScope(principal, current.branchId);

      const deleted = await repo.softDeleteHoliday(tx, id);
      if (!deleted) throw AppError.notFound('Tatil kaydı bulunamadı');
    });

    this.invalidateAvailability();
  }

  /**
   * Kiracı GENELİ tatil yazmak kiracı kapsamlı bir rol ister.
   *
   * Şube yöneticisinin `schedule:write` izni vardır ama kapsamı kendi
   * şubesidir; `branchId: null` bir kayıt TÜM şubelerin takvimini kapatır.
   * İzin kontrolü bu farkı göremez (izin listesi tek bir anahtar), kapsam
   * kontrolü görebilir — ayrım `BranchAccessService`in üyelik/aidiyet
   * ayrımıyla aynı gerekçeye dayanıyor.
   */
  private async assertHolidayScope(principal: Principal, branchId: string | null): Promise<void> {
    if (branchId === null) {
      if (!principal.tenantWide) {
        throw new AppError(
          403,
          ERROR_CODES.BRANCH_FORBIDDEN,
          'Kiracı geneli tatil için tüm şubeleri kapsayan bir rol gerekir',
          { detail: 'Şube yöneticisi yalnız kendi şubesine tatil tanımlayabilir.' },
        );
      }
      return;
    }
    await this.branchAccess.assertInput(principal, branchId);
  }

  private static assertHolidayRowScope(principal: Principal, branchId: string | null): void {
    if (branchId === null) {
      if (!principal.tenantWide) {
        throw new AppError(
          403,
          ERROR_CODES.BRANCH_FORBIDDEN,
          'Kiracı geneli tatil için tüm şubeleri kapsayan bir rol gerekir',
        );
      }
      return;
    }
    BranchAccessService.assertMembership(principal, branchId);
  }

  /**
   * `isClosed` ile saat aralığı arasındaki bağ — `holidays_time_window` check
   * constraint'inin uygulama tarafındaki karşılığı. DB'ye bırakılsaydı hata
   * 500 olurdu; kullanıcının gördüğü mesaj neyi yanlış yaptığını söylemeli.
   */
  private static resolveHolidayHours(
    isClosed: boolean,
    openTime: string | undefined,
    closeTime: string | undefined,
  ): { isClosed: boolean; openTime?: string | undefined; closeTime?: string | undefined } {
    if (isClosed) {
      // Tam kapalı günde saat TAŞINMAZ; gövdede geldiyse istek çelişkilidir.
      if (openTime !== undefined || closeTime !== undefined) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Kapalı tatil gününe saat aralığı yazılamaz',
          { detail: 'Yarım gün açılış için isClosed: false gönderin.' },
        );
      }
      return { isClosed: true };
    }

    if (openTime === undefined || closeTime === undefined) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Yarım gün açılışta openTime ve closeTime zorunludur',
      );
    }
    if (openTime >= closeTime) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'openTime, closeTime değerinden önce olmalıdır',
      );
    }
    return { isClosed: false, openTime, closeTime };
  }

  private static translateHoliday(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return AppError.conflict(
        ERROR_CODES.CONFLICT,
        'Bu tarih için zaten bir tatil kaydı var',
        { detail: 'Aynı şube (veya kiracı geneli) ve tarih için tek kayıt tutulur.' },
      );
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return AppError.notFound('Şube bulunamadı');
    }
    // Kapsam trigger'ı ve `holidays_time_window` aynı SQLSTATE'i kullanıyor;
    // saat çelişkisi yukarıda zaten elendiği için buraya kalan tek olasılık
    // şubenin başka kiracıya ait olmasıdır.
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Şube bu kiracıya ait olmalı');
    }
    return error;
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

  private static toHolidayResponse(row: repo.HolidayRow): HolidayResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      branchId: row.branchId,
      holidayDate: row.holidayDate,
      name: row.name,
      isClosed: row.isClosed,
      openTime: row.openTime,
      closeTime: row.closeTime,
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
