import { Injectable } from '@nestjs/common';
import { ERROR_CODES, PERMISSIONS } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  toPage,
  type Page,
} from '../../common/pagination';
import { toZonedIso, zonedDayRange } from '../../common/time';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import { hasPermission } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import * as appointmentsRepo from './appointments.repository';
import * as repo from './calendar.repository';
import * as settingsRepo from './booking-settings.repository';
import type {
  CalendarDayQueryDto,
  CalendarEntryDto,
  CalendarResponseDto,
  CalendarStaffQueryDto,
  CalendarWeekQueryDto,
  ListAppointmentsQueryDto,
} from './dto/calendar.dto';

/** Liste ucunda izin verilen en geniş aralık. */
const MAX_RANGE_DAYS = 92;

@Injectable()
export class CalendarService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async day(principal: Principal, query: CalendarDayQueryDto): Promise<CalendarResponseDto> {
    return this.rangeView(principal, query.branchId, query.date, 1, query.staffProfileId);
  }

  async week(principal: Principal, query: CalendarWeekQueryDto): Promise<CalendarResponseDto> {
    return this.rangeView(principal, query.branchId, query.weekStart, 7, query.staffProfileId);
  }

  async staff(principal: Principal, query: CalendarStaffQueryDto): Promise<CalendarResponseDto> {
    await this.branchAccess.assertInput(principal, query.branchId);
    const from = new Date(query.from);
    const to = new Date(query.to);
    CalendarService.assertRange(from, to);

    const timezone = await this.timezoneOf(query.branchId);
    return this.load(principal, query.branchId, timezone, from, to, query.staffProfileId);
  }

  /**
   * Filtreli randevu listesi — cursor sayfalamalı.
   *
   * `limit + 1` satır okunur; fazladan satır "daha var mı?" sorusunu ikinci bir
   * sorgu olmadan cevaplar.
   */
  async list(
    principal: Principal,
    query: ListAppointmentsQueryDto,
  ): Promise<Page<CalendarEntryDto>> {
    if (query.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, query.branchId);
    }

    const from = new Date(query.from);
    const to = new Date(query.to);
    CalendarService.assertRange(from, to);

    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);
    const restrictTo = await this.ownStaffProfileId(principal);

    const timezone = await this.timezoneOf(query.branchId);
    const rows = await this.tx.run((tx) =>
      repo.listCalendar(tx, {
        branchId: query.branchId,
        from,
        to,
        customerId: query.customerId,
        staffProfileId: query.staffProfileId,
        statuses: query.status,
        restrictToStaffProfileId: restrictTo,
        limit: limit + 1,
        cursorStartsAt: cursor?.sortKey,
        cursorId: cursor?.id,
      }),
    );

    const page = toPage(rows, limit, (row) => ({
      sortKey: new Date(row.starts_at).toISOString(),
      id: row.id,
    }));

    return {
      data: page.data.map((row) => CalendarService.toEntry(row, timezone)),
      pageInfo: page.pageInfo,
    };
  }

  // ---------------------------------------------------------------------------
  private async rangeView(
    principal: Principal,
    branchId: string,
    localDate: string,
    dayCount: number,
    staffProfileId: string | undefined,
  ): Promise<CalendarResponseDto> {
    await this.branchAccess.assertInput(principal, branchId);

    const timezone = await this.timezoneOf(branchId);
    // Gün sınırı ŞUBE saat diliminde belirlenir; UTC gününe göre kesmek
    // +03:00'lık bir klinikte sabahın ilk randevularını bir önceki güne yazardı.
    const { from, to } = zonedDayRange(localDate, timezone, dayCount);

    return this.load(principal, branchId, timezone, from, to, staffProfileId);
  }

  /** Saat dilimi PARAMETRE: çağıran onu zaten okumuştur, ikinci kez sormak
   *  aynı isteği gereksiz bir sorgu daha yaptırırdı. */
  private async load(
    principal: Principal,
    branchId: string,
    timezone: string,
    from: Date,
    to: Date,
    staffProfileId: string | undefined,
  ): Promise<CalendarResponseDto> {
    const restrictTo = await this.ownStaffProfileId(principal);

    const payload = await this.tx.run(async (tx) => {
      const rows = await repo.listCalendar(tx, {
        branchId,
        from,
        to,
        staffProfileId,
        restrictToStaffProfileId: restrictTo,
        limit: MAX_PAGE_SIZE * 5,
      });
      const density = await repo.loadDensity(tx, {
        branchId,
        from,
        to,
        restrictToStaffProfileId: restrictTo,
      });
      return { rows, density };
    });

    return {
      branchId,
      timezone,
      from: toZonedIso(from, timezone),
      to: toZonedIso(to, timezone),
      appointments: payload.rows.map((row) => CalendarService.toEntry(row, timezone)),
      density: payload.density.map((row) => ({
        localDay: row.local_day,
        localHour: row.local_hour,
        appointmentCount: row.appointment_count,
      })),
    };
  }

  /**
   * `practitioner` kısıtı: `appointment:read.all` yoksa yalnız KENDİ
   * randevuları döner.
   *
   * `undefined` = kısıt yok. Kullanıcının personel profili yoksa (ör. yalnız
   * uygulayıcı rolü verilmiş ama profil açılmamış) kimliği eşleşmeyen bir
   * değer döneriz; boş sonuç, yanlışlıkla tüm takvimi açmaktan iyidir.
   */
  private async ownStaffProfileId(principal: Principal): Promise<string | undefined> {
    if (hasPermission(principal, PERMISSIONS.APPOINTMENT_READ_ALL)) return undefined;

    const own = await this.tx.run((tx) =>
      appointmentsRepo.findStaffProfileIdByUser(tx, principal.userId),
    );
    return own ?? '00000000-0000-0000-0000-000000000000';
  }

  private async timezoneOf(branchId: string | undefined): Promise<string> {
    if (branchId === undefined) return 'Europe/Istanbul';
    const branch = await this.tx.run((tx) => settingsRepo.findBranchForBooking(tx, branchId));
    if (branch === undefined) throw AppError.notFound('Şube bulunamadı');
    return branch.timezone;
  }

  private static assertRange(from: Date, to: Date): void {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Tarih aralığı geçersiz');
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Aralık en fazla ${MAX_RANGE_DAYS} gün olabilir`,
      );
    }
  }

  private static toEntry(row: repo.CalendarRow, timezone: string): CalendarEntryDto {
    return {
      id: row.id,
      branchId: row.branch_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      status: row.status,
      startsAt: toZonedIso(new Date(row.starts_at), timezone),
      endsAt: toZonedIso(new Date(row.ends_at), timezone),
      notes: row.notes,
      version: row.version,
      totalMinor: Number(row.total_minor),
      services: row.services.map((service) => ({
        id: service.id,
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        staffProfileId: service.staffProfileId,
        sortOrder: service.sortOrder,
        startsAt: toZonedIso(new Date(service.startsAt), timezone),
        endsAt: toZonedIso(new Date(service.endsAt), timezone),
        priceMinor: Number(service.priceMinor),
      })),
    };
  }
}
