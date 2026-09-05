import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { assertRange } from '../../common/dto/date-range.dto';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import type {
  NoShowQueryDto,
  NoShowReportDto,
  NoShowTotalsDto,
  RetentionQueryDto,
  RetentionReportDto,
  RetentionTotalsDto,
  StaffPerformanceQueryDto,
  StaffPerformanceReportDto,
} from './dto/report.dto';
import { percentDelta, previousPeriod, toPeriod, type Period } from './report-period';
import { branchFilterSql, type ReportScope } from './report-scope';
import { ReportScopeService } from './report-scope.service';
import { bookedMinutesCte, workingMinutesCtes } from './sql/working-minutes';

/** Yüzde, iki basamağa yuvarlanmış. Payda sıfırsa oran sıfırdır. */
function rate(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

/**
 * Personel performansı, no-show/iptal ve müşteri retention.
 *
 * Üçü tek serviste çünkü üçü de aynı çekirdek kümeyi okuyor: penceredeki
 * randevular ve onların durumları. Ayrı servislere bölmek, aynı `appointments`
 * süzgecini üç kez farklı yorumlama riskini getirirdi — no-show oranının
 * paydası ile performans raporunun randevu sayısının ayrışması, tam olarak
 * kullanıcının fark edemeyeceği türden bir tutarsızlık.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly scopes: ReportScopeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Personel performansı
  // ---------------------------------------------------------------------------

  /**
   * İşlem sayısı, ciro, prim ve doluluk — personel başına tek satır.
   *
   * Ciro `charges` üzerinden okunuyor, `appointment_services.price_minor`
   * üzerinden DEĞİL. İkisi çoğu zaman aynı ama indirim, fiyat override'ı ve
   * KDV yalnız `charges`te yaşıyor; kalem fiyatını toplamak, kliniğin fiilen
   * yazdığı borçtan farklı bir sayı üretirdi ve ciro raporuyla çelişirdi.
   */
  async staffPerformance(
    principal: Principal,
    query: StaffPerformanceQueryDto,
  ): Promise<StaffPerformanceReportDto> {
    assertRange(query.from, query.to);
    const scope = await this.scopes.resolve(principal, query.branchId, query.staffProfileId);
    const period = toPeriod(query.from, query.to);
    const from = period.from.toISOString();
    const to = period.to.toISOString();
    const params = {
      from: period.from,
      to: period.to,
      branchIds: scope.branchIds,
      staffProfileId: scope.staffProfileId,
    };

    const result = await this.tx.run(async (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        with ${workingMinutesCtes(params)},
             ${bookedMinutesCte(params)},

        -- Tamamlanmış hizmet kalemleri. Randevu DURUMU süzgeç: planlanmış ama
        -- yapılmamış bir iş performans değildir.
        done as (
          select aps.id, aps.staff_profile_id
            from appointment_services aps
            join appointments a on a.id = aps.appointment_id
           where a.status = 'completed'
             and a.deleted_at is null
             and aps.starts_at >= ${from}::timestamptz
             and aps.starts_at <  ${to}::timestamptz
             and ${branchFilterSql(scope.branchIds, sql`a.branch_id`)}
             and (${scope.staffProfileId ?? null}::uuid is null
                  or aps.staff_profile_id = ${scope.staffProfileId ?? null}::uuid)
        ),

        per_staff_work as (
          select d.staff_profile_id,
                 count(*)::int as completed_services,
                 -- Bir kaleme birden çok ücret satırı bağlanabilir; toplam
                 -- kalem başına önce toplanıyor, sonra personele.
                 coalesce(sum(ch.total_minor), 0)::bigint as revenue_minor
            from done d
            left join charges ch
              on ch.appointment_service_id = d.id
             and ch.status = 'open'
           group by 1
        ),

        -- Prim tahakkukları AYRI okunuyor: tetikleyicisi tahsilat olan bir prim
        -- randevunun gününde değil, paranın alındığı günde doğar.
        per_staff_commission as (
          select ca.staff_profile_id,
                 sum(ca.amount_minor)::bigint as commission_minor
            from commission_accruals ca
           where ca.created_at >= ${from}::timestamptz
             and ca.created_at <  ${to}::timestamptz
             and ${branchFilterSql(scope.branchIds, sql`ca.branch_id`)}
             and (${scope.staffProfileId ?? null}::uuid is null
                  or ca.staff_profile_id = ${scope.staffProfileId ?? null}::uuid)
           group by 1
        ),

        per_staff_minutes as (
          select sa.staff_profile_id,
                 sum(sa.available_minutes) as available_minutes
            from staff_available sa
           group by 1
        ),

        per_staff_booked as (
          select b.staff_profile_id, sum(b.booked_minutes) as booked_minutes
            from booked b
           group by 1
        ),

        -- Personel kümesi DÖRT kaynağın birleşimi: sadece çalışmış, sadece
        -- randevu almış ya da sadece primi olan biri de raporda görünmeli.
        roster as (
          select staff_profile_id from per_staff_work
          union select staff_profile_id from per_staff_commission
          union select staff_profile_id from per_staff_minutes
          union select staff_profile_id from per_staff_booked
        )

        select r.staff_profile_id,
               u.full_name,
               coalesce(w.completed_services, 0)::int    as completed_services,
               coalesce(w.revenue_minor, 0)::bigint      as revenue_minor,
               coalesce(cm.commission_minor, 0)::bigint  as commission_minor,
               coalesce(bk.booked_minutes, 0)::numeric   as booked_minutes,
               coalesce(mn.available_minutes, 0)::numeric as available_minutes
          from roster r
          join staff_profiles sp on sp.id = r.staff_profile_id
          join users u on u.id = sp.user_id
          left join per_staff_work w        on w.staff_profile_id = r.staff_profile_id
          left join per_staff_commission cm on cm.staff_profile_id = r.staff_profile_id
          left join per_staff_minutes mn    on mn.staff_profile_id = r.staff_profile_id
          left join per_staff_booked bk     on bk.staff_profile_id = r.staff_profile_id
         order by revenue_minor desc, u.full_name
      `),
    );

    return {
      scope: scope.kind,
      period: { from: query.from, to: query.to },
      currency: 'TRY',
      data: result.rows.map((row) => {
        const booked = Number(row.booked_minutes ?? 0);
        const available = Number(row.available_minutes ?? 0);
        return {
          staffProfileId: row.staff_profile_id as string,
          staffName: String(row.full_name),
          completedServices: Number(row.completed_services ?? 0),
          revenueMinor: Number(row.revenue_minor ?? 0),
          commissionMinor: Number(row.commission_minor ?? 0),
          bookedMinutes: Math.round(booked),
          availableMinutes: Math.round(available),
          occupancyRate: rate(booked, available),
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // No-show ve iptal
  // ---------------------------------------------------------------------------

  async noShow(principal: Principal, query: NoShowQueryDto): Promise<NoShowReportDto> {
    assertRange(query.from, query.to);
    const scope = await this.scopes.resolve(principal, query.branchId);
    const period = toPeriod(query.from, query.to);
    const groupBy = query.groupBy ?? 'staff';

    const [rows, byOrigin] = await Promise.all([
      this.noShowRows(scope, period, groupBy),
      this.noShowByOrigin(scope, period),
    ]);
    const totals = PerformanceService.sumNoShow(rows);

    const report: NoShowReportDto = {
      period: { from: query.from, to: query.to },
      totals,
      data: rows.map(({ groupId, groupLabel, ...counts }) => ({ groupId, groupLabel, ...counts })),
      byOrigin,
    };

    if (query.compareTo === 'previous') {
      const previous = PerformanceService.sumNoShow(
        await this.noShowRows(scope, previousPeriod(period), groupBy),
      );
      report.previous = previous;
      report.delta = {
        total: percentDelta(totals.total, previous.total),
        noShow: percentDelta(totals.noShow, previous.noShow),
        noShowRate: percentDelta(totals.noShowRate, previous.noShowRate),
        cancellationRate: percentDelta(totals.cancellationRate, previous.cancellationRate),
      };
    }

    return report;
  }

  /**
   * Randevu grain'i mi, hizmet grain'i mi?
   *
   * RANDEVU. Bir no-show, gelmeyen bir müşteridir; içinde üç hizmet olması onu
   * üç no-show yapmaz. Personel kırılımı bu yüzden randevunun İLK hizmetinin
   * personeline bakıyor — bir randevuyu iki personele bölüp yarım no-show
   * saymaktansa, tutarlı bir atıf kuralı seçmek daha dürüst.
   */
  private async noShowRows(
    scope: ReportScope,
    period: Period,
    groupBy: 'staff' | 'branch' | 'service' | 'day',
  ): Promise<(NoShowTotalsDto & { groupId: string | null; groupLabel: string })[]> {
    const grouping = PerformanceService.noShowGrouping(groupBy);

    const result = await this.tx.run(async (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        with scoped as (
          select a.id, a.branch_id, a.status, a.starts_at,
                 first_service.staff_profile_id, first_service.service_id
            from appointments a
            left join lateral (
              select aps.staff_profile_id, aps.service_id
                from appointment_services aps
               where aps.appointment_id = a.id
               order by aps.sort_order
               limit 1
            ) first_service on true
           where a.deleted_at is null
             and a.starts_at >= ${period.from.toISOString()}::timestamptz
             and a.starts_at <  ${period.to.toISOString()}::timestamptz
             and ${branchFilterSql(scope.branchIds, sql`a.branch_id`)}
        )
        select ${grouping.id} as group_id,
               ${grouping.label} as group_label,
               count(*)::int                                             as total,
               count(*) filter (where s.status = 'completed')::int        as completed,
               count(*) filter (where s.status = 'no_show')::int          as no_show,
               count(*) filter (where s.status = 'cancelled')::int        as cancelled
          from scoped s
          ${grouping.join}
         group by 1, 2
         order by no_show desc, group_label
      `),
    );

    return result.rows.map((row) => {
      const total = Number(row.total ?? 0);
      const noShow = Number(row.no_show ?? 0);
      const cancelled = Number(row.cancelled ?? 0);
      return {
        groupId: (row.group_id ?? null) as string | null,
        groupLabel: (row.group_label as string | null) ?? '—',
        total,
        completed: Number(row.completed ?? 0),
        noShow,
        cancelled,
        noShowRate: rate(noShow, total),
        cancellationRate: rate(cancelled, total),
      };
    });
  }

  /**
   * Online ve iç randevunun no-show oranı AYRI.
   *
   * Bölüm 11'in 8. ürün sorusu tam olarak bunu soruyor: kapora almadan online
   * randevu açtık, no-show'u ne sınırlayacak? Cevabın ölçüsü bu iki satır.
   */
  private async noShowByOrigin(
    scope: ReportScope,
    period: Period,
  ): Promise<NoShowReportDto['byOrigin']> {
    const result = await this.tx.run(async (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        select a.origin::text as origin,
               count(*)::int                                       as total,
               count(*) filter (where a.status = 'completed')::int as completed,
               count(*) filter (where a.status = 'no_show')::int   as no_show,
               count(*) filter (where a.status = 'cancelled')::int as cancelled
          from appointments a
         where a.deleted_at is null
           and a.starts_at >= ${period.from.toISOString()}::timestamptz
           and a.starts_at <  ${period.to.toISOString()}::timestamptz
           and ${branchFilterSql(scope.branchIds, sql`a.branch_id`)}
         group by 1
         order by 1
      `),
    );

    return result.rows.map((row) => {
      const total = Number(row.total ?? 0);
      const noShow = Number(row.no_show ?? 0);
      const cancelled = Number(row.cancelled ?? 0);
      return {
        origin: row.origin as 'internal' | 'online',
        total,
        completed: Number(row.completed ?? 0),
        noShow,
        cancelled,
        noShowRate: rate(noShow, total),
        cancellationRate: rate(cancelled, total),
      };
    });
  }

  private static noShowGrouping(groupBy: 'staff' | 'branch' | 'service' | 'day'): {
    id: SQL;
    label: SQL;
    join: SQL;
  } {
    switch (groupBy) {
      case 'branch':
        return {
          id: sql`s.branch_id`,
          label: sql`b.name`,
          join: sql`join branches b on b.id = s.branch_id`,
        };
      case 'service':
        return {
          id: sql`s.service_id`,
          label: sql`coalesce(sv.name, '—')`,
          join: sql`left join services sv on sv.id = s.service_id`,
        };
      case 'day':
        return {
          id: sql`null::uuid`,
          label: sql`(s.starts_at at time zone b.timezone)::date::text`,
          join: sql`join branches b on b.id = s.branch_id`,
        };
      default:
        return {
          id: sql`s.staff_profile_id`,
          label: sql`coalesce(u.full_name, '—')`,
          join: sql`
            left join staff_profiles sp on sp.id = s.staff_profile_id
            left join users u on u.id = sp.user_id
          `,
        };
    }
  }

  private static sumNoShow(rows: NoShowTotalsDto[]): NoShowTotalsDto {
    const add = (key: 'total' | 'completed' | 'noShow' | 'cancelled'): number =>
      rows.reduce((sum, row) => sum + row[key], 0);
    const total = add('total');
    const noShow = add('noShow');
    const cancelled = add('cancelled');
    return {
      total,
      completed: add('completed'),
      noShow,
      cancelled,
      // Oranlar satır oranlarının ortalaması DEĞİL; toplam pay / toplam payda.
      noShowRate: rate(noShow, total),
      cancellationRate: rate(cancelled, total),
    };
  }

  // ---------------------------------------------------------------------------
  // Kazanım ve retention
  // ---------------------------------------------------------------------------

  async retention(principal: Principal, query: RetentionQueryDto): Promise<RetentionReportDto> {
    assertRange(query.from, query.to);
    const scope = await this.scopes.resolve(principal, query.branchId);
    const period = toPeriod(query.from, query.to);

    const [totals, acquisition, cohorts] = await Promise.all([
      this.retentionTotals(scope, period),
      this.acquisition(scope, period),
      this.cohorts(scope, period),
    ]);

    const report: RetentionReportDto = {
      period: { from: query.from, to: query.to },
      totals,
      acquisition,
      cohorts,
    };

    if (query.compareTo === 'previous') {
      const previous = await this.retentionTotals(scope, previousPeriod(period));
      report.previous = previous;
      report.delta = {
        newCustomers: percentDelta(totals.newCustomers, previous.newCustomers),
        returningCustomers: percentDelta(totals.returningCustomers, previous.returningCustomers),
        activeCustomers: percentDelta(totals.activeCustomers, previous.activeCustomers),
      };
    }

    return report;
  }

  /**
   * Yeni ve geri gelen müşteri.
   *
   * "Yeni", `customers.created_at` DEĞİL, penceredeki ilk TAMAMLANMIŞ
   * randevusudur. Kayıt tarihi bir pazarlama sayısı; klinik için müşteri,
   * ayağıyla gelip işlem yaptırdığında müşteri olur. Kayıt açıp hiç gelmeyen
   * biri kazanım sayılsaydı, kazanım grafiği randevu sayfasındaki spam'le
   * birlikte yükselirdi.
   */
  private async retentionTotals(
    scope: ReportScope,
    period: Period,
  ): Promise<RetentionTotalsDto> {
    const row = await this.tx.run(async (tx) => {
      const result = await tx.execute<Record<string, unknown>>(sql`
        with visits as (
          select a.customer_id, min(a.starts_at) as first_in_window
            from appointments a
           where a.status = 'completed'
             and a.deleted_at is null
             and a.starts_at >= ${period.from.toISOString()}::timestamptz
             and a.starts_at <  ${period.to.toISOString()}::timestamptz
             and ${branchFilterSql(scope.branchIds, sql`a.branch_id`)}
           group by 1
        )
        select count(*)::int as active_customers,
               count(*) filter (
                 where not exists (
                   select 1 from appointments prior
                    where prior.customer_id = v.customer_id
                      and prior.status = 'completed'
                      and prior.deleted_at is null
                      and prior.starts_at < v.first_in_window
                 )
               )::int as new_customers
          from visits v
      `);
      return result.rows[0];
    });

    const active = Number(row?.active_customers ?? 0);
    const fresh = Number(row?.new_customers ?? 0);
    const returning = active - fresh;
    return {
      newCustomers: fresh,
      returningCustomers: returning,
      activeCustomers: active,
      returningRate: rate(returning, active),
    };
  }

  /** Geliş kaynağı kırılımı — `customers.source`. */
  private async acquisition(
    scope: ReportScope,
    period: Period,
  ): Promise<RetentionReportDto['acquisition']> {
    const result = await this.tx.run(async (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        select c.source, count(distinct c.id)::int as customers
          from customers c
         where c.deleted_at is null
           and c.merged_into_customer_id is null
           and exists (
             select 1 from appointments a
              where a.customer_id = c.id
                and a.status = 'completed'
                and a.deleted_at is null
                and a.starts_at >= ${period.from.toISOString()}::timestamptz
                and a.starts_at <  ${period.to.toISOString()}::timestamptz
                and ${branchFilterSql(scope.branchIds, sql`a.branch_id`)}
           )
         group by 1
         order by customers desc, c.source nulls last
      `),
    );

    return result.rows.map((row) => ({
      source: (row.source ?? null) as string | null,
      customers: Number(row.customers ?? 0),
    }));
  }

  /**
   * Penceredeki YENİ müşterilerin geri dönüş oranı.
   *
   * Kohort penceresi bugüne yakınsa 90 günlük oran yapısal olarak düşük
   * çıkar — kimsenin 90 günü dolmamıştır. Bunu sunucuda "düzeltmek"
   * (kohortu kırpmak) sayının anlamını gizlerdi; DTO açıklaması bunu söylüyor
   * ve istemci uyarıyı gösteriyor.
   */
  private async cohorts(
    scope: ReportScope,
    period: Period,
  ): Promise<RetentionReportDto['cohorts']> {
    const result = await this.tx.run(async (tx) => {
      const rows = await tx.execute<Record<string, unknown>>(sql`
        with first_visits as (
          select a.customer_id, min(a.starts_at) as first_at
            from appointments a
           where a.status = 'completed'
             and a.deleted_at is null
             and a.starts_at >= ${period.from.toISOString()}::timestamptz
             and a.starts_at <  ${period.to.toISOString()}::timestamptz
             and ${branchFilterSql(scope.branchIds, sql`a.branch_id`)}
           group by 1
        ),
        cohort as (
          select fv.customer_id, fv.first_at
            from first_visits fv
           where not exists (
             select 1 from appointments prior
              where prior.customer_id = fv.customer_id
                and prior.status = 'completed'
                and prior.deleted_at is null
                and prior.starts_at < fv.first_at
           )
        )
        select count(*)::int as cohort_size,
               count(*) filter (where returned.within_30)::int as returned_30,
               count(*) filter (where returned.within_60)::int as returned_60,
               count(*) filter (where returned.within_90)::int as returned_90
          from cohort c
          cross join lateral (
            select
              exists (select 1 from appointments a2
                       where a2.customer_id = c.customer_id
                         and a2.status = 'completed'
                         and a2.deleted_at is null
                         and a2.starts_at > c.first_at
                         and a2.starts_at <= c.first_at + interval '30 days') as within_30,
              exists (select 1 from appointments a2
                       where a2.customer_id = c.customer_id
                         and a2.status = 'completed'
                         and a2.deleted_at is null
                         and a2.starts_at > c.first_at
                         and a2.starts_at <= c.first_at + interval '60 days') as within_60,
              exists (select 1 from appointments a2
                       where a2.customer_id = c.customer_id
                         and a2.status = 'completed'
                         and a2.deleted_at is null
                         and a2.starts_at > c.first_at
                         and a2.starts_at <= c.first_at + interval '90 days') as within_90
          ) returned
      `);
      return rows.rows[0];
    });

    const size = Number(result?.cohort_size ?? 0);
    return [30, 60, 90].map((withinDays) => {
      const returned = Number(result?.[`returned_${withinDays}`] ?? 0);
      return { withinDays, returned, rate: rate(returned, size) };
    });
  }
}
