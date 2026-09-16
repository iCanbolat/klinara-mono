import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { groupKey, pageRows } from './report-page';
import { assertRange } from '../../common/dto/date-range.dto';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import type { Principal } from '../identity/principal';
import type {
  RevenueQueryDto,
  RevenueReportDto,
  RevenueRowDto,
  RevenueTotalsDto,
} from './dto/report.dto';
import { percentDelta, previousPeriod, toPeriod, type Period } from './report-period';
import { branchFilterSql, type ReportScope } from './report-scope';
import { ReportScopeService } from './report-scope.service';

/**
 * Ciro — dönemde doğan hizmet bedeli (tahakkuk).
 *
 * Kaynak yalnız `charges`: randevu tamamlandığında ve paket satıldığında doğan,
 * iptal edilmemiş kalemler. Tahsilat ve iade takibi 0045 ile kapsamdan çıktı;
 * rapor "bu dönemde ne kadar hizmet verildi" sorusunu cevaplıyor, "kasaya ne
 * girdi" sorusunu değil.
 */
@Injectable()
export class RevenueService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly scopes: ReportScopeService,
  ) {}

  async report(principal: Principal, query: RevenueQueryDto): Promise<RevenueReportDto> {
    assertRange(query.from, query.to);
    const scope = await this.scopes.resolve(principal, query.branchId);
    const period = toPeriod(query.from, query.to);
    const groupBy = query.groupBy ?? 'service';

    const [totals, rows] = await Promise.all([
      this.totals(scope, period),
      this.rows(scope, period, groupBy),
    ]);

    // `totals` zaten satırlardan bağımsız hesaplanıyor (ayrı sorgu) ve
    // sayfalamadan etkilenmiyor.
    const page = pageRows(rows, query, groupKey);

    const report: RevenueReportDto = {
      scope: scope.kind,
      period: { from: query.from, to: query.to },
      totals,
      data: page.data,
      pageInfo: page.pageInfo,
    };

    if (query.compareTo === 'previous') {
      const previous = await this.totals(scope, previousPeriod(period));
      report.previous = previous;
      report.delta = {
        accruedMinor: percentDelta(totals.accruedMinor, previous.accruedMinor),
      };
    }

    return report;
  }

  /**
   * Günlük tanecikli ciro — şube yerel gününde.
   *
   * Snapshot yenileyicisi bunu çağırıyor. Raporun kendisi hâlâ toplamları tek
   * sorguda okuyor: ciroda kırılımlar (hizmet, paket, personel) günlük
   * satırlardan TÜRETİLEMEZ, çünkü bir kalemin hizmeti günden bağımsız bir
   * boyut. Doluluktan farkı bu; orada tek boyut personel ve gün, burada beş.
   */
  async daily(
    scope: ReportScope,
    period: Period,
    tx?: Tx,
  ): Promise<
    {
      branchId: string;
      branchName: string;
      localDate: string;
      accruedMinor: number;
    }[]
  > {
    const from = period.from.toISOString();
    const to = period.to.toISOString();

    const run = async (handle: Tx): Promise<{ rows: Record<string, unknown>[] }> =>
      handle.execute<Record<string, unknown>>(sql`
        with scope_branches as (
          select b.id as branch_id, b.name as branch_name, b.timezone
            from branches b
           where b.deleted_at is null
             and ${branchFilterSql(scope.branchIds, sql`b.id`)}
        ),
        accrued as (
          select c.branch_id,
                 (c.created_at at time zone sb.timezone)::date as local_date,
                 sum(c.total_minor) as amount
            from charges c
            join scope_branches sb on sb.branch_id = c.branch_id
           where c.status = 'open'
             and c.created_at >= ${from}::timestamptz
             and c.created_at <  ${to}::timestamptz
           group by 1, 2
        )
        select a.branch_id, sb.branch_name, a.local_date::text as local_date,
               coalesce(a.amount, 0)::bigint as accrued_minor
          from accrued a
          join scope_branches sb on sb.branch_id = a.branch_id
         order by a.local_date, sb.branch_name
      `);

    const result = tx === undefined ? await this.tx.run(run) : await run(tx);

    return result.rows.map((row) => ({
      branchId: row.branch_id as string,
      branchName: String(row.branch_name),
      localDate: String(row.local_date),
      accruedMinor: Number(row.accrued_minor ?? 0),
    }));
  }

  /** Dönem toplamı — kırılımdan ve sayfalamadan bağımsız. */
  private async totals(scope: ReportScope, period: Period): Promise<RevenueTotalsDto> {
    const from = period.from.toISOString();
    const to = period.to.toISOString();

    const row = await this.tx.run(async (tx) => {
      const result = await tx.execute<Record<string, unknown>>(sql`
        select
          (select coalesce(sum(c.total_minor), 0)
             from charges c
            where c.status = 'open'
              and c.created_at >= ${from}::timestamptz
              and c.created_at <  ${to}::timestamptz
              and ${branchFilterSql(scope.branchIds, sql`c.branch_id`)}) as accrued_minor,

          -- Kiracının para birimi tek; yine de uydurmuyoruz, gerçek bir
          -- satırdan okuyoruz ve hiç satır yoksa varsayılana düşüyoruz.
          (select coalesce(max(c.currency), 'TRY') from charges c limit 1) as currency
      `);
      return result.rows[0];
    });

    return {
      accruedMinor: Number(row?.accrued_minor ?? 0),
      currency: (row?.currency as string | undefined) ?? 'TRY',
    };
  }

  /** Kırılım satırları — hizmet, paket, personel, şube ya da gün. */
  private async rows(
    scope: ReportScope,
    period: Period,
    groupBy: 'service' | 'package' | 'staff' | 'branch' | 'day',
  ): Promise<RevenueRowDto[]> {
    const from = period.from.toISOString();
    const to = period.to.toISOString();

    const grouping = RevenueService.grouping(groupBy);

    const result = await this.tx.run(async (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        with scoped_charges as (
          select c.id, c.branch_id, c.total_minor, c.created_at,
                 c.appointment_service_id, c.customer_package_id
            from charges c
           where c.status = 'open'
             and c.created_at >= ${from}::timestamptz
             and c.created_at <  ${to}::timestamptz
             and ${branchFilterSql(scope.branchIds, sql`c.branch_id`)}
        )

        select ${grouping.id} as group_id,
               ${grouping.label} as group_label,
               sum(sc.total_minor)::bigint as accrued_minor
          from scoped_charges sc
          ${grouping.join}
         group by 1, 2
         order by accrued_minor desc, group_label
      `),
    );

    return result.rows.map((row) => ({
      groupId: (row.group_id ?? null) as string | null,
      groupLabel: (row.group_label as string | null) ?? '—',
      accruedMinor: Number(row.accrued_minor ?? 0),
    }));
  }

  private static grouping(
    groupBy: 'service' | 'package' | 'staff' | 'branch' | 'day',
  ): { id: SQL; label: SQL; join: SQL } {
    switch (groupBy) {
      case 'branch':
        return {
          id: sql`sc.branch_id`,
          label: sql`b.name`,
          join: sql`join branches b on b.id = sc.branch_id`,
        };
      case 'day':
        // Şube yerel günü: iki şube farklı saat diliminde olsa bile her kalem
        // KENDİ şubesinin gününe düşer.
        return {
          id: sql`null::uuid`,
          label: sql`(sc.created_at at time zone b.timezone)::date::text`,
          join: sql`join branches b on b.id = sc.branch_id`,
        };
      case 'staff':
        // Personelsiz kalemler (paket satışı, ürün, elle açılan) LEFT JOIN ile
        // hayatta kalıyor ve "—" etiketiyle toplanıyor; düşseydi kırılım
        // toplamı genel toplamı tutmazdı.
        return {
          id: sql`aps.staff_profile_id`,
          label: sql`coalesce(u.full_name, '—')`,
          join: sql`
            left join appointment_services aps on aps.id = sc.appointment_service_id
            left join staff_profiles sp on sp.id = aps.staff_profile_id
            left join users u on u.id = sp.user_id
          `,
        };
      case 'package':
        return {
          id: sql`sc.customer_package_id`,
          label: sql`coalesce(cp.definition_name, '—')`,
          join: sql`left join customer_packages cp on cp.id = sc.customer_package_id`,
        };
      default:
        return {
          id: sql`aps.service_id`,
          label: sql`coalesce(s.name, '—')`,
          join: sql`
            left join appointment_services aps on aps.id = sc.appointment_service_id
            left join services s on s.id = aps.service_id
          `,
        };
    }
  }
}
