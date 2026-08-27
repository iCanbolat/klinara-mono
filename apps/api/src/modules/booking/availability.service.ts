import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { toZonedIso } from '../../common/time';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import { canAccessBranch } from '../identity/principal';
import { AvailabilityCacheService } from './availability-cache.service';
import * as repo from './availability.repository';
import * as settingsRepo from './booking-settings.repository';
import type { AvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';

/** 30 günlük pencere üst sınırı: kabul kriteri p95 < 200 ms bu aralık için. */
const MAX_WINDOW_DAYS = 31;

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly cache: AvailabilityCacheService,
  ) {}

  async findSlots(
    principal: Principal,
    query: AvailabilityQueryDto,
    now: Date = new Date(),
  ): Promise<AvailabilityResponseDto> {
    if (!canAccessBranch(principal, query.branchId)) {
      throw new AppError(403, ERROR_CODES.BRANCH_FORBIDDEN, 'Bu şubede yetkiniz yok');
    }
    return this.computeSlots(query, now);
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
    AvailabilityService.assertWindow(from, to);

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

      const rows = await repo.findAvailableSlots(tx, {
        branchId: query.branchId,
        serviceIds: query.serviceIds,
        from,
        to,
        staffProfileId: query.staffProfileId,
        slotGranularityMinutes: settings.slotGranularityMinutes,
        minLeadMinutes: settings.minLeadMinutes,
        maxAdvanceDays: settings.maxAdvanceDays,
        now,
      });

      return {
        branchId: query.branchId,
        timezone: branch.timezone,
        slotGranularityMinutes: settings.slotGranularityMinutes,
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

  private static assertWindow(from: Date, to: Date): void {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Tarih aralığı geçersiz');
    }
    if (to <= from) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, '`to`, `from` değerinden sonra olmalı');
    }
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > MAX_WINDOW_DAYS) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Uygunluk sorgusu en fazla ${MAX_WINDOW_DAYS} gün olabilir`,
      );
    }
  }
}
