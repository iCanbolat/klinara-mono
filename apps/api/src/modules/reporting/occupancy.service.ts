import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { assertRange } from '../../common/dto/date-range.dto';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import type { Principal } from '../identity/principal';
import type {
  OccupancyQueryDto,
  OccupancyReportDto,
  OccupancyRowDto,
  OccupancyTotalsDto,
} from './dto/report.dto';
import { percentDelta, previousPeriod, toPeriod, type Period } from './report-period';
import type { ReportScope } from './report-scope';
import { ReportScopeService } from './report-scope.service';
import { bookedMinutesCte, workingMinutesCtes } from './sql/working-minutes';

/**
 * Doluluğun günlük tanecikli ham satırı — raporun TEK gerçek kaynağı.
 *
 * Kırılımlar bu satırlardan JS'te toplanıyor, SQL'de değil. Sebep snapshot:
 * `report_snapshots` tam olarak bu şekli saklıyor ve snapshot'tan okunan bir
 * rapor, canlı sorgudan okunan raporla AYNI toplama kodundan geçiyor. İki ayrı
 * toplama yolu olsaydı, ikisinin bir gün ayrışması kaçınılmazdı ve fark
 * kullanıcıya "dün 62 diyordu, bugün 61 diyor" olarak görünürdü.
 */
export interface OccupancyDailyRow {
  branchId: string;
  branchName: string;
  staffProfileId: string;
  staffName: string;
  /** Şube yerel günü, `YYYY-MM-DD`. */
  localDate: string;
  bookedMinutes: number;
  availableMinutes: number;
}

/** Yüzde, iki basamak. Payda sıfırsa oran sıfır. */
function rate(booked: number, available: number): number {
  if (available <= 0) return 0;
  return Math.round((booked / available) * 10000) / 100;
}

/**
 * Doluluk oranı — personel/şube × zaman.
 *
 * Pay ve payda AYRI hesaplanıp sonra birleştiriliyor, tek bir join'de değil.
 * Bir personelin o gün müsait dakikası olmadan da randevusu olabilir (mesai
 * dışı override) ve tersine, hiç randevusu olmayan bir personelin de paydası
 * vardır. Tek join'de bunlardan biri sessizce kaybolurdu — ve kaybolan taraf
 * hep aynı yönde hata üretirdi: doluluk olduğundan yüksek.
 */
@Injectable()
export class OccupancyService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly scopes: ReportScopeService,
  ) {}

  async report(principal: Principal, query: OccupancyQueryDto): Promise<OccupancyReportDto> {
    assertRange(query.from, query.to);
    const scope = await this.scopes.resolve(principal, query.branchId, query.staffProfileId);
    const period = toPeriod(query.from, query.to);
    const groupBy = query.groupBy ?? 'staff';

    const rows = OccupancyService.group(await this.daily(scope, period), groupBy);
    const totals = OccupancyService.sum(rows);

    const report: OccupancyReportDto = {
      scope: scope.kind,
      period: { from: query.from, to: query.to },
      totals,
      data: rows,
    };

    if (query.compareTo === 'previous') {
      const previous = OccupancyService.sum(
        OccupancyService.group(await this.daily(scope, previousPeriod(period)), groupBy),
      );
      report.previous = previous;
      report.delta = {
        bookedMinutes: percentDelta(totals.bookedMinutes, previous.bookedMinutes),
        availableMinutes: percentDelta(totals.availableMinutes, previous.availableMinutes),
        occupancyRate: percentDelta(totals.occupancyRate, previous.occupancyRate),
      };
    }

    return report;
  }

  /**
   * Günlük ham satırlar. Snapshot yenileyicisi de bunu çağırıyor — hesabın
   * tek bir tanımı olsun diye.
   *
   * `tx` VERİLEBİLİR ve kuyruk yolu için şart: worker'ın istek bağlamı yok,
   * dolayısıyla `this.tx.run()` (bağlam ister) orada 401 verir. Transaction'ı
   * dışarıdan almak, aynı servisin hem HTTP hem kuyruk yolundan
   * çağrılabilmesini sağlıyor — ve snapshot'ın canlı raporla aynı SQL'i
   * kullanması bu yüzden mümkün.
   */
  async daily(scope: ReportScope, period: Period, tx?: Tx): Promise<OccupancyDailyRow[]> {
    const params = {
      from: period.from,
      to: period.to,
      branchIds: scope.branchIds,
      staffProfileId: scope.staffProfileId,
    };

    const run = async (handle: Tx): Promise<{ rows: Record<string, unknown>[] }> =>
      handle.execute<Record<string, unknown>>(sql`
        with ${workingMinutesCtes(params)},
             ${bookedMinutesCte(params)},

        -- Pay ve payda TAM BİRLEŞİM ile buluşuyor: yalnız çalışılan günler
        -- (randevusuz personel) ve yalnız randevulu günler (mesai dışı iş)
        -- ikisi de raporda kalmalı.
        combined as (
          select coalesce(a.branch_id, b.branch_id)               as branch_id,
                 coalesce(a.staff_profile_id, b.staff_profile_id) as staff_profile_id,
                 coalesce(a.local_date, b.local_date)             as local_date,
                 coalesce(a.available_minutes, 0)                 as available_minutes,
                 coalesce(b.booked_minutes, 0)                    as booked_minutes
            from staff_available a
            full join booked b
              on b.branch_id = a.branch_id
             and b.staff_profile_id = a.staff_profile_id
             and b.local_date = a.local_date
        )

        select c.branch_id,
               rb.branch_name,
               c.staff_profile_id,
               u.full_name as staff_name,
               c.local_date::text as local_date,
               c.booked_minutes,
               c.available_minutes
          from combined c
          join report_branches rb on rb.branch_id = c.branch_id
          join staff_profiles sp on sp.id = c.staff_profile_id
          join users u on u.id = sp.user_id
         order by c.local_date, u.full_name
      `);

    const result = tx === undefined ? await this.tx.run(run) : await run(tx);

    return result.rows.map((row) => ({
      branchId: row.branch_id as string,
      branchName: String(row.branch_name),
      staffProfileId: row.staff_profile_id as string,
      staffName: String(row.staff_name),
      localDate: String(row.local_date),
      bookedMinutes: Math.round(Number(row.booked_minutes ?? 0)),
      availableMinutes: Math.round(Number(row.available_minutes ?? 0)),
    }));
  }

  /**
   * Günlük satırları istenen kırılıma toplar — SAF.
   *
   * Canlı sorgu ve snapshot okuması buradan geçiyor; testlerde de doğrudan
   * çağrılabiliyor.
   */
  static group(
    rows: readonly OccupancyDailyRow[],
    groupBy: 'staff' | 'branch' | 'day',
  ): OccupancyRowDto[] {
    const buckets = new Map<
      string,
      { groupId: string | null; groupLabel: string; booked: number; available: number }
    >();

    for (const row of rows) {
      const key =
        groupBy === 'branch' ? row.branchId : groupBy === 'day' ? row.localDate : row.staffProfileId;
      // Gün kırılımında `groupId` NULL: yerel tarih bir kimlik değil, etiketin
      // kendisi. Uydurma bir uuid üretmek istemciyi yanıltırdı.
      const groupId = groupBy === 'day' ? null : key;
      const groupLabel =
        groupBy === 'branch' ? row.branchName : groupBy === 'day' ? row.localDate : row.staffName;

      const bucket = buckets.get(key) ?? { groupId, groupLabel, booked: 0, available: 0 };
      bucket.booked += row.bookedMinutes;
      bucket.available += row.availableMinutes;
      buckets.set(key, bucket);
    }

    return [...buckets.values()]
      .map((bucket) => ({
        groupId: bucket.groupId,
        groupLabel: bucket.groupLabel,
        bookedMinutes: bucket.booked,
        availableMinutes: bucket.available,
        occupancyRate: rate(bucket.booked, bucket.available),
      }))
      .sort((left, right) =>
        groupBy === 'day'
          ? left.groupLabel.localeCompare(right.groupLabel)
          : right.bookedMinutes - left.bookedMinutes ||
            left.groupLabel.localeCompare(right.groupLabel, 'tr'),
      );
  }

  /**
   * Toplam oran, satır oranlarının ORTALAMASI DEĞİL.
   *
   * Ortalamak, yarım gün çalışan bir personelin oranına tam gün çalışanla eşit
   * ağırlık verirdi. Toplam pay / toplam payda tek doğru cevap.
   */
  static sum(rows: readonly OccupancyRowDto[]): OccupancyTotalsDto {
    const booked = rows.reduce((total, row) => total + row.bookedMinutes, 0);
    const available = rows.reduce((total, row) => total + row.availableMinutes, 0);
    return {
      bookedMinutes: booked,
      availableMinutes: available,
      occupancyRate: rate(booked, available),
    };
  }
}
