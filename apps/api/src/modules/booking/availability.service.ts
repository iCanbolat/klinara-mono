import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { toZonedIso } from '../../common/time';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import { AvailabilityCacheService } from './availability-cache.service';
import * as repo from './availability.repository';
import * as settingsRepo from './booking-settings.repository';
import type {
  AvailabilityDayDto,
  AvailabilityDaysQueryDto,
  AvailabilityDaysResponseDto,
  AvailabilityQueryDto,
  AvailabilityResponseDto,
} from './dto/availability.dto';

/** 30 günlük pencere üst sınırı: kabul kriteri p95 < 200 ms bu aralık için. */
const MAX_WINDOW_DAYS = 31;
/**
 * Gün durumu sorgusu slot üretmiyor, gün başına tek satır: bir ay görünümü
 * (dış günlerle 6 hafta = 42 gün) tek istekte sığsın diye daha geniş.
 */
const MAX_DAYS_WINDOW_DAYS = 62;

const toDayDto = (row: repo.DayStatusRow): AvailabilityDayDto => ({
  date: row.local_date,
  status: row.status,
  holidayName: row.holiday_name,
  opensAt: row.opens_at,
  closesAt: row.closes_at,
});

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly cache: AvailabilityCacheService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async findSlots(
    principal: Principal,
    query: AvailabilityQueryDto,
    now: Date = new Date(),
  ): Promise<AvailabilityResponseDto> {
    await this.branchAccess.assertInput(principal, query.branchId);
    return this.computeSlots(query, now);
  }

  /**
   * Yalnız gün durumları — tarih seçicinin kapalı/tatil günleri işaretlemesi
   * için. Hizmet ve personel gerekmiyor; gün kuralı şubenindir.
   */
  async findDays(
    principal: Principal,
    query: AvailabilityDaysQueryDto,
    now: Date = new Date(),
  ): Promise<AvailabilityDaysResponseDto> {
    await this.branchAccess.assertInput(principal, query.branchId);
    const from = new Date(query.from);
    const to = new Date(query.to);
    AvailabilityService.assertWindow(from, to, MAX_DAYS_WINDOW_DAYS);

    return this.tx.run(async (tx) => {
      const branch = await settingsRepo.findBranchForBooking(tx, query.branchId);
      if (branch === undefined) throw AppError.notFound('Şube bulunamadı');
      const settings = await settingsRepo.getBookingSettings(tx, this.tx.tenantId);
      if (settings === undefined) throw AppError.notFound('Kiracı ayarları bulunamadı');

      const rows = await repo.findDayStatuses(tx, {
        branchId: query.branchId,
        from,
        to,
        minLeadMinutes: settings.minLeadMinutes,
        maxAdvanceDays: settings.maxAdvanceDays,
        now,
      });
      return { branchId: query.branchId, timezone: branch.timezone, days: rows.map(toDayDto) };
    });
  }

  /**
   * Yetki kontrolü OLMADAN hesaplama.
   *
   * Yalnız sunucunun kendi içinden çağrılır (çakışma yanıtındaki alternatif
   * slot önerisi). Erişim kararı çağıran uçta çoktan verilmiştir; principal'ı
   * sahte bir nesneyle taklit etmek yerine kontrolü açıkça dışarıda bırakmak,
   * hangi yolun yetki kontrolünden geçtiğini okunur kılar.
   */
  async computeSlots(
    query: AvailabilityQueryDto,
    now: Date = new Date(),
  ): Promise<AvailabilityResponseDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    AvailabilityService.assertWindow(from, to, MAX_WINDOW_DAYS);

    const cacheKey = AvailabilityCacheService.key(this.tx.tenantId, [
      query.branchId,
      [...query.serviceIds].join(','),
      query.staffProfileId,
      from.toISOString(),
      to.toISOString(),
    ]);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const response = await this.tx.run(async (tx) => {
      const branch = await settingsRepo.findBranchForBooking(tx, query.branchId);
      if (branch === undefined) throw AppError.notFound('Şube bulunamadı');

      const settings = await settingsRepo.getBookingSettings(tx, this.tx.tenantId);
      if (settings === undefined) throw AppError.notFound('Kiracı ayarları bulunamadı');

      // Gün kuralı ÖNCE: penceredeki hiçbir gün açık değilse (tatil, kapalı
      // gün, geçmiş, rezervasyon sınırı ötesi) pahalı slot sorgusuna hiç
      // girilmiyor ve istemci boş listenin NEDENİNİ `days`ten okuyor.
      const days = await repo.findDayStatuses(tx, {
        branchId: query.branchId,
        from,
        to,
        minLeadMinutes: settings.minLeadMinutes,
        maxAdvanceDays: settings.maxAdvanceDays,
        now,
      });

      const rows = days.some((day) => day.status === 'open')
        ? await repo.findAvailableSlots(tx, {
            branchId: query.branchId,
            serviceIds: query.serviceIds,
            from,
            to,
            staffProfileId: query.staffProfileId,
            slotGranularityMinutes: settings.slotGranularityMinutes,
            minLeadMinutes: settings.minLeadMinutes,
            maxAdvanceDays: settings.maxAdvanceDays,
            now,
          })
        : [];

      return {
        branchId: query.branchId,
        timezone: branch.timezone,
        slotGranularityMinutes: settings.slotGranularityMinutes,
        days: days.map(toDayDto),
        slots: rows.map((row) => ({
          startsAt: toZonedIso(new Date(row.slot_start), branch.timezone),
          endsAt: toZonedIso(new Date(row.visible_end), branch.timezone),
          staffProfileIds: row.staff_profile_ids,
        })),
      };
    });

    this.cache.set(cacheKey, response);
    return response;
  }

  private static assertWindow(from: Date, to: Date, maxDays: number): void {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Tarih aralığı geçersiz');
    }
    if (to <= from) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, '`to`, `from` değerinden sonra olmalı');
    }
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > maxDays) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Uygunluk sorgusu en fazla ${maxDays} gün olabilir`,
      );
    }
  }
}
