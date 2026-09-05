import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ERROR_CODES, PERMISSIONS } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  toPage,
} from '../../common/pagination';
import { TenantTxService } from '../../database/tenant-tx.service';
import { hasPermission, type Principal } from '../identity/principal';
import type {
  ExpiringReportDto,
  ExpiringReportQueryDto,
  ExpiringRowDto,
  OutstandingReportDto,
  OutstandingReportQueryDto,
  UsageReportDto,
  UsageReportQueryDto,
} from './dto/package-report.dto';

/**
 * Kalan hakkın parasal karşılığı — SQL karşılığı `common/money.remainingValueMinor`.
 *
 * `unit_list_price_minor` bu formülde GEÇMEZ: kampanyalı satılan bir paketin
 * yükümlülüğü liste fiyatından hesaplanırsa klinik taşımadığı bir borcu
 * raporlar. Tamsayı aritmetiği, kalem başına yarım-yukarı yuvarlama.
 */
const OUTSTANDING_MINOR = sql`
  sum((i.item_total_minor * i.remaining_sessions * 2 + i.quantity_total)
      / (i.quantity_total * 2))::bigint
`;

@Injectable()
export class PackageReportsService {
  constructor(private readonly tx: TenantTxService) {}

  /**
   * Kliniğin TAŞIDIĞI YÜKÜMLÜLÜK: satılmış ama kullanılmamış seansların
   * parasal karşılığı.
   *
   * İade edilmiş, süresi dolmuş ve devredilmiş paketler doğal olarak dışarıda
   * kalır — kalan hakları defter üzerinden zaten sıfırlanmıştır — ama sorgu
   * yine de `status = 'active'` diyor: sıfırlanmayı atlamış bir satır
   * raporlanmamalı.
   */
  async outstanding(query: OutstandingReportQueryDto): Promise<OutstandingReportDto> {
    const groupBy = query.groupBy ?? 'service';
    const grouping = PackageReportsService.outstandingGrouping(groupBy);

    const { rows, totals } = await this.tx.run(async (tx) => {
      const filters = sql`
        where i.remaining_sessions > 0
          and p.status = 'active'
          and p.deleted_at is null
          and (${query.branchId ?? null}::uuid is null
               or p.branch_id = ${query.branchId ?? null}::uuid)
          and (${query.serviceId ?? null}::uuid is null
               or i.service_id = ${query.serviceId ?? null}::uuid)
      `;

      const grouped = await tx.execute<Record<string, unknown>>(sql`
        select ${grouping.id} as group_id,
               ${grouping.label} as group_label,
               count(distinct p.id)::int as packages,
               sum(i.remaining_sessions)::int as remaining_sessions,
               ${OUTSTANDING_MINOR} as outstanding_minor
          from customer_package_items i
          join customer_packages p on p.id = i.customer_package_id
          ${grouping.join}
          ${filters}
         group by 1, 2
         order by outstanding_minor desc, group_label
      `);

      const summary = await tx.execute<Record<string, unknown>>(sql`
        select count(distinct p.id)::int as packages,
               coalesce(sum(i.remaining_sessions), 0)::int as remaining_sessions,
               coalesce(${OUTSTANDING_MINOR}, 0) as outstanding_minor,
               coalesce(max(p.currency), 'TRY') as currency
          from customer_package_items i
          join customer_packages p on p.id = i.customer_package_id
          ${filters}
      `);

      return { rows: grouped.rows, totals: summary.rows[0] };
    });

    return {
      totals: {
        packages: Number(totals?.packages ?? 0),
        remainingSessions: Number(totals?.remaining_sessions ?? 0),
        outstandingMinor: Number(totals?.outstanding_minor ?? 0),
        currency: (totals?.currency as string | undefined) ?? 'TRY',
      },
      data: rows.map((row) => ({
        groupId: (row.group_id ?? null) as string | null,
        groupLabel: (row.group_label ?? '—') as string,
        packages: Number(row.packages),
        remainingSessions: Number(row.remaining_sessions),
        outstandingMinor: Number(row.outstanding_minor),
      })),
    };
  }

  /** Yaklaşan süre dolumu. Aralık YARI AÇIK: `[from, to)`. */
  async expiring(
    principal: Principal,
    query: ExpiringReportQueryDto,
  ): Promise<ExpiringReportDto> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);
    const showMoney = hasPermission(principal, PERMISSIONS.REPORT_REVENUE_READ);
    PackageReportsService.assertRange(query.from, query.to);

    const rows = await this.tx.run(async (tx) => {
      const result = await tx.execute<Record<string, unknown>>(sql`
        select p.id, p.customer_id, p.branch_id, p.definition_name, p.expires_at,
               p.remaining_sessions, c.full_name,
               ${
                 // Para kolonu izinsiz kullanıcıya SQL'DE düşürülüyor. Listeyi
                 // çekip sonra elemek sayfa boyutunu bozardı (limit 50 iste,
                 // 12 satır al) — Ek G'nin not görünürlüğü kararının aynısı.
                 showMoney
                   ? sql`(select ${OUTSTANDING_MINOR} from customer_package_items i
                           where i.customer_package_id = p.id and i.remaining_sessions > 0)`
                   : sql`null::bigint`
               } as outstanding_minor
          from customer_packages p
          join customers c on c.id = p.customer_id
         where p.status = 'active'
           and p.deleted_at is null
           and p.remaining_sessions > 0
           and p.expires_at >= ${query.from}::timestamptz
           and p.expires_at <  ${query.to}::timestamptz
           and (${query.branchId ?? null}::uuid is null
                or p.branch_id = ${query.branchId ?? null}::uuid)
           and (${cursor?.sortKey ?? null}::timestamptz is null
                or (p.expires_at, p.id)
                   > (${cursor?.sortKey ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
         order by p.expires_at asc, p.id asc
         limit ${limit + 1}
      `);
      return result.rows;
    });

    const mapped: (ExpiringRowDto & { sortKey: string })[] = rows.map((row) => {
      const expiresAt = new Date(row.expires_at as string).toISOString();
      return {
        customerPackageId: row.id as string,
        customerId: row.customer_id as string,
        customerName: row.full_name as string,
        packageName: row.definition_name as string,
        branchId: row.branch_id as string,
        remainingSessions: Number(row.remaining_sessions),
        expiresAt,
        ...(showMoney ? { outstandingMinor: Number(row.outstanding_minor ?? 0) } : {}),
        sortKey: expiresAt,
      };
    });

    const page = toPage(mapped, limit, (row) => ({
      sortKey: row.sortKey,
      id: row.customerPackageId,
    }));

    return {
      data: page.data.map(({ sortKey: _sortKey, ...row }) => row),
      pageInfo: page.pageInfo,
    };
  }

  /** Dönem içindeki defter hareketleri — satılan, tüketilen, iade, süre dolumu. */
  async usage(query: UsageReportQueryDto): Promise<UsageReportDto> {
    const groupBy = query.groupBy ?? 'service';
    PackageReportsService.assertRange(query.from, query.to);

    const grouping =
      groupBy === 'branch'
        ? { id: sql`p.branch_id`, label: sql`b.name`, join: sql`join branches b on b.id = p.branch_id` }
        : { id: sql`i.service_id`, label: sql`i.service_name`, join: sql`` };

    const rows = await this.tx.run(async (tx) => {
      const result = await tx.execute<Record<string, unknown>>(sql`
        select ${grouping.id} as group_id,
               ${grouping.label} as group_label,
               coalesce(sum(e.delta) filter (where e.entry_type = 'purchase'), 0)::int as purchased,
               -- Ters kayıtlar aynı entry_type ile ve ters işaretle yazıldığı
               -- için toplama dahil: geri alınan bir tüketim raporda görünmez.
               coalesce(-sum(e.delta) filter (where e.entry_type = 'consume'), 0)::int as consumed,
               coalesce(-sum(e.delta) filter (where e.entry_type = 'refund'), 0)::int as refunded,
               coalesce(-sum(e.delta) filter (where e.entry_type = 'expire'), 0)::int as expired,
               coalesce(-sum(e.delta) filter (where e.entry_type = 'transfer_out'), 0)::int as transferred,
               coalesce(sum(e.delta) filter (where e.entry_type = 'manual_adjustment'), 0)::int as adjusted
          from package_ledger_entries e
          join customer_package_items i on i.id = e.customer_package_item_id
          join customer_packages p on p.id = e.customer_package_id
          ${grouping.join}
         where e.created_at >= ${query.from}::timestamptz
           and e.created_at <  ${query.to}::timestamptz
           and (${query.branchId ?? null}::uuid is null
                or p.branch_id = ${query.branchId ?? null}::uuid)
         group by 1, 2
         order by group_label
      `);
      return result.rows;
    });

    return {
      data: rows.map((row) => ({
        groupId: (row.group_id ?? null) as string | null,
        groupLabel: (row.group_label ?? '—') as string,
        purchased: Number(row.purchased),
        consumed: Number(row.consumed),
        refunded: Number(row.refunded),
        expired: Number(row.expired),
        transferred: Number(row.transferred),
        adjusted: Number(row.adjusted),
      })),
    };
  }

  private static outstandingGrouping(groupBy: 'service' | 'customer' | 'branch'): {
    id: SQL;
    label: SQL;
    join: SQL;
  } {
    if (groupBy === 'customer') {
      return {
        id: sql`p.customer_id`,
        label: sql`c.full_name`,
        join: sql`join customers c on c.id = p.customer_id`,
      };
    }
    if (groupBy === 'branch') {
      return {
        id: sql`p.branch_id`,
        label: sql`b.name`,
        join: sql`join branches b on b.id = p.branch_id`,
      };
    }
    return { id: sql`i.service_id`, label: sql`i.service_name`, join: sql`` };
  }

  private static assertRange(from: string, to: string): void {
    if (new Date(to).getTime() <= new Date(from).getTime()) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Aralık geçersiz', {
        detail: '`to` değeri `from` değerinden büyük olmalıdır (yarı açık aralık).',
      });
    }
  }
}
