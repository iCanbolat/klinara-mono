import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
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
 * Ciro — tahakkuk eden ve tahsil edilen, ayrı ayrı.
 *
 * İkisi AYNI SAYI DEĞİLDİR ve raporun en sık yanlış okunan yeri burasıdır:
 * tahakkuk "bu dönemde ne kadar borç doğdu", tahsilat "bu dönemde kasaya ne
 * girdi". Eylülde açılan bir kalem ekimde tahsil edilir; tek bir "ciro" sayısı
 * vermek, hangi soruyu cevapladığını söylemeden cevap vermek olurdu.
 *
 * UZLAŞMA KURALI: bu servisin `collectedMinor` toplamı, aynı pencere ve
 * şubeler için `payments` tablosunun toplamına BİREBİR eşit olmak zorunda.
 * `reports.test.ts` bunu iki ayrı uçtan çapraz doğruluyor — batch'in asıl
 * kabul kriteri o test.
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

    const report: RevenueReportDto = {
      scope: scope.kind,
      period: { from: query.from, to: query.to },
      totals,
      data: rows,
    };

    if (query.compareTo === 'previous') {
      const previous = await this.totals(scope, previousPeriod(period));
      report.previous = previous;
      report.delta = {
        accruedMinor: percentDelta(totals.accruedMinor, previous.accruedMinor),
        collectedMinor: percentDelta(totals.collectedMinor, previous.collectedMinor),
        refundedMinor: percentDelta(totals.refundedMinor, previous.refundedMinor),
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
      collectedMinor: number;
      refundedMinor: number;
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
        ),
        collected as (
          select p.branch_id,
                 (p.paid_at at time zone sb.timezone)::date as local_date,
                 sum(p.amount_minor) as amount
            from payments p
            join scope_branches sb on sb.branch_id = p.branch_id
           where p.status = 'posted'
             and p.paid_at >= ${from}::timestamptz
             and p.paid_at <  ${to}::timestamptz
           group by 1, 2
        ),
        refunded as (
          select r.branch_id,
                 (r.refunded_at at time zone sb.timezone)::date as local_date,
                 sum(r.amount_minor) as amount
            from refunds r
            join scope_branches sb on sb.branch_id = r.branch_id
           where r.refunded_at >= ${from}::timestamptz
             and r.refunded_at <  ${to}::timestamptz
           group by 1, 2
        ),
        -- Üç kaynağın BİRLEŞİMİ: yalnız tahsilat olan bir gün de, yalnız kalem
        -- açılan bir gün de kovada durmalı.
        keys as (
          select branch_id, local_date from accrued
          union select branch_id, local_date from collected
          union select branch_id, local_date from refunded
        )
        select k.branch_id, sb.branch_name, k.local_date::text as local_date,
               coalesce(a.amount, 0)::bigint as accrued_minor,
               coalesce(c.amount, 0)::bigint as collected_minor,
               coalesce(r.amount, 0)::bigint as refunded_minor
          from keys k
          join scope_branches sb on sb.branch_id = k.branch_id
          left join accrued   a on a.branch_id = k.branch_id and a.local_date = k.local_date
          left join collected c on c.branch_id = k.branch_id and c.local_date = k.local_date
          left join refunded  r on r.branch_id = k.branch_id and r.local_date = k.local_date
         order by k.local_date, sb.branch_name
      `);

    const result = tx === undefined ? await this.tx.run(run) : await run(tx);

    return result.rows.map((row) => ({
      branchId: row.branch_id as string,
      branchName: String(row.branch_name),
      localDate: String(row.local_date),
      accruedMinor: Number(row.accrued_minor ?? 0),
      collectedMinor: Number(row.collected_minor ?? 0),
      refundedMinor: Number(row.refunded_minor ?? 0),
    }));
  }

  /**
   * Üç toplam, üç ayrı tablodan.
   *
   * Tek bir sorguda join'lemek cazip ama YANLIŞ olurdu: bir tahsilat birden
   * çok kaleme dağıtılabiliyor ve bir kalem birden çok tahsilat alabiliyor,
   * yani join satırları çoğaltır ve toplamlar şişer. Bu, finans raporlarının
   * klasik hatası; ayrı skaler alt sorgular onu yapısal olarak imkânsız
   * kılıyor.
   */
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

          -- İptal edilen (void) tahsilat SAYILMAZ; satırı duruyor ama para
          -- kasada değil.
          (select coalesce(sum(p.amount_minor), 0)
             from payments p
            where p.status = 'posted'
              and p.paid_at >= ${from}::timestamptz
              and p.paid_at <  ${to}::timestamptz
              and ${branchFilterSql(scope.branchIds, sql`p.branch_id`)}) as collected_minor,

          (select coalesce(sum(r.amount_minor), 0)
             from refunds r
            where r.refunded_at >= ${from}::timestamptz
              and r.refunded_at <  ${to}::timestamptz
              and ${branchFilterSql(scope.branchIds, sql`r.branch_id`)}) as refunded_minor,

          -- Kiracının para birimi tek; yine de uydurmuyoruz, gerçek bir
          -- satırdan okuyoruz ve hiç satır yoksa varsayılana düşüyoruz.
          (select coalesce(max(p.currency), 'TRY') from payments p limit 1) as currency
      `);
      return result.rows[0];
    });

    return {
      accruedMinor: Number(row?.accrued_minor ?? 0),
      collectedMinor: Number(row?.collected_minor ?? 0),
      refundedMinor: Number(row?.refunded_minor ?? 0),
      currency: (row?.currency as string | undefined) ?? 'TRY',
    };
  }

  /**
   * Kırılım satırları.
   *
   * Tahakkuk ve tahsilat AYNI satırda ama ayrı yollardan geliyor: tahakkuk
   * doğrudan `charges`ten, tahsilat `payment_allocations` üzerinden. Tahsilatı
   * kaleme bağlayan tek gerçek dağıtım satırıdır — "tahsilatı kalemlerin
   * oranına böl" gibi bir tahmin, kısmi tahsilatta yanlış cevap verirdi.
   *
   * `method` kırılımı istisna: ödeme yöntemi bir kalem özelliği değil, tahsilat
   * özelliğidir; o kırılımda tahakkuk sütunu anlamsız olacağı için sıfır kalır.
   *
   * ⚠️ SATIRLARIN TAHSİLAT TOPLAMI, `totals.collectedMinor`DAN KÜÇÜK OLABİLİR
   * ve bu bir hata değil. Satırlar "bu dönemde açılan kalemlere bu dönemde
   * tahsil edilen"i gösteriyor; geçen ayın borcuna bu ay yapılan bir tahsilat
   * genel toplamda var, kırılımda yok — çünkü bağlanacağı kalem pencerede
   * değil. Alternatif, o tahsilatı kalemi olmayan bir "diğer" satırına
   * yığmaktı; kırılımı toplamla eşitlerdi ama hizmet kırılımını anlamsız
   * kılardı. İstemci bu farkı toplamdan okuyor, satırları toplayarak değil.
   */
  private async rows(
    scope: ReportScope,
    period: Period,
    groupBy: 'service' | 'package' | 'staff' | 'branch' | 'day' | 'method',
  ): Promise<RevenueRowDto[]> {
    const from = period.from.toISOString();
    const to = period.to.toISOString();

    if (groupBy === 'method') return this.methodRows(scope, period);

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
        ),

        -- Kalem başına TAHSİL EDİLEN. Dağıtım satırları append-only olduğu
        -- için iptal edilmiş bir tahsilatın satırı da duruyor; posted
        -- süzgeci burada şart.
        collected as (
          select a.charge_id, sum(a.amount_minor) as collected_minor
            from payment_allocations a
            join payments p on p.id = a.payment_id and p.status = 'posted'
           where p.paid_at >= ${from}::timestamptz
             and p.paid_at <  ${to}::timestamptz
           group by a.charge_id
        )

        select ${grouping.id} as group_id,
               ${grouping.label} as group_label,
               sum(sc.total_minor)::bigint                    as accrued_minor,
               coalesce(sum(col.collected_minor), 0)::bigint  as collected_minor
          from scoped_charges sc
          ${grouping.join}
          left join collected col on col.charge_id = sc.id
         group by 1, 2
         order by accrued_minor desc, group_label
      `),
    );

    return result.rows.map((row) => ({
      groupId: (row.group_id ?? null) as string | null,
      groupLabel: (row.group_label as string | null) ?? '—',
      accruedMinor: Number(row.accrued_minor ?? 0),
      collectedMinor: Number(row.collected_minor ?? 0),
    }));
  }

  /** Ödeme yöntemi kırılımı — yalnız tahsilat tarafı. */
  private async methodRows(scope: ReportScope, period: Period): Promise<RevenueRowDto[]> {
    const result = await this.tx.run(async (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        select p.method::text as group_label,
               sum(p.amount_minor)::bigint as collected_minor
          from payments p
         where p.status = 'posted'
           and p.paid_at >= ${period.from.toISOString()}::timestamptz
           and p.paid_at <  ${period.to.toISOString()}::timestamptz
           and ${branchFilterSql(scope.branchIds, sql`p.branch_id`)}
         group by 1
         order by collected_minor desc, group_label
      `),
    );

    return result.rows.map((row) => ({
      groupId: null,
      groupLabel: String(row.group_label),
      accruedMinor: 0,
      collectedMinor: Number(row.collected_minor ?? 0),
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
