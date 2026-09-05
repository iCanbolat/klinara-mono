import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { OccupancyService } from './occupancy.service';
import type { Period } from './report-period';
import { RevenueService } from './revenue.service';

/**
 * Gece yenilenen rapor özetleri.
 *
 * MATERIALIZED VIEW DEĞİL — `0039`'un başlığı gerekçeyi taşıyor: matview RLS'e
 * uymaz ve `security_invoker` karşılığı yoktur. Burada yazılan her satır
 * `report_snapshots` tablosuna, kiracının kendi RLS bağlamında düşüyor.
 *
 * DIVERGENCE'A KARŞI TEK SAVUNMA: bu servis kendi SQL'ini YAZMIYOR. Sayılar
 * `OccupancyService.daily` ve `RevenueService.daily`den geliyor, yani canlı
 * raporun okuduğu tam olarak aynı sorgudan. Snapshot'ın canlıdan farklı bir
 * sayı üretmesi, ancak ikisi arasına ikinci bir hesap girerse mümkün olurdu ve
 * o hesap burada yok.
 */
@Injectable()
export class SnapshotService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly occupancy: OccupancyService,
    private readonly revenue: RevenueService,
  ) {}

  /**
   * Verilen pencereyi kiracı için yeniden yazar.
   *
   * `tx` ZORUNLU ve bu bilinçli: yenileme okuma + yazma + süpürmeden oluşuyor
   * ve üçünün TEK transaction'da olması şart. Ayrı transaction'larda okusaydık,
   * okumayla yazma arasına giren bir randevu, yazılan özetin hiçbir zaman var
   * olmamış bir duruma ait olmasına yol açardı.
   *
   * Ayrıca kuyruk yolunun tek çalışma biçimi bu: worker'ın istek bağlamı yok,
   * `this.tx.run()` orada 401 verir. Bağlamı `runForTenant` kuruyor ve
   * transaction'ı buraya geçiriyor.
   *
   * Kapsam `branchIds: null` — gece işi kiracının TAMAMINI yeniliyor. Bu, izin
   * daraltmasının atlandığı tek yol ve güvenli: burada bir principal yok,
   * yalnız kiracı var ve RLS zaten kiracıyı kilitlemiş durumda.
   */
  async refresh(period: Period, tx: Tx): Promise<number> {
    const scope = { branchIds: null, staffProfileId: null, kind: 'all' as const, showMoney: true };

    // Sıralı, paralel DEĞİL: ikisi aynı transaction'ı paylaşıyor ve tek bir
    // PG bağlantısı üzerinde eş zamanlı iki sorgu çalıştırmak sürücüde
    // tanımsız davranış.
    const occupancyRows = await this.occupancy.daily(scope, period, tx);
    const revenueRows = await this.revenue.daily(scope, period, tx);

    const runAt = new Date();

    {
      // MARK AND SWEEP, "önce sil sonra yaz" DEĞİL.
      //
      // Silme-yazma sırasının kaçınılmaz bir kenar durumu var: silme penceresi
      // UTC gününde, yazılan satırlar ise ŞUBE YEREL gününde. İkisi bir gün
      // kayabildiği için geniş silmek yeniden yazılmayan bir günü düşürüyor,
      // dar silmek ise tekil anahtar çakışması veriyordu.
      //
      // Bunun yerine: her satır bu koşuşun damgasıyla yazılıyor, sonra
      // penceredeki DAMGASI ESKİ kalan satırlar süpürülüyor. Boşalan bir kova
      // (randevu silindi, kalem iptal edildi) böylece gerçekten kayboluyor ve
      // hiçbir geçerli gün gözden düşmüyor.
      await SnapshotService.upsert(
        tx,
        'occupancy',
        runAt,
        occupancyRows.map((row) => ({
          branchId: row.branchId,
          localDate: row.localDate,
          groupKind: 'staff',
          groupId: row.staffProfileId,
          groupLabel: row.staffName,
          metrics: {
            bookedMinutes: row.bookedMinutes,
            availableMinutes: row.availableMinutes,
          },
        })),
      );

      await SnapshotService.upsert(
        tx,
        'revenue',
        runAt,
        revenueRows.map((row) => ({
          branchId: row.branchId,
          localDate: row.localDate,
          groupKind: 'total',
          groupId: null,
          groupLabel: row.branchName,
          metrics: {
            accruedMinor: row.accruedMinor,
            collectedMinor: row.collectedMinor,
            refundedMinor: row.refundedMinor,
            appointments: 0,
          },
        })),
      );

      await tx.execute(sql`
        delete from report_snapshots
         where bucket_date >= ${SnapshotService.day(period.from)}::date
           and bucket_date <= ${SnapshotService.day(period.to)}::date
           and computed_at < ${runAt.toISOString()}::timestamptz
      `);
    }

    return occupancyRows.length + revenueRows.length;
  }

  /**
   * Kovaları TEK sorguda yazar.
   *
   * Satır başına bir `insert` çalıştırmak, 50 şubelik bir kiracının 35 günlük
   * yenilemesinde on binlerce gidiş-dönüş demekti. Gövde boş olduğunda sorgu
   * hiç kurulmuyor: `values ()` sözdizimsel hata.
   */
  private static async upsert(
    tx: Parameters<Parameters<TenantTxService['run']>[0]>[0],
    reportName: 'occupancy' | 'revenue',
    runAt: Date,
    rows: readonly {
      branchId: string;
      localDate: string;
      groupKind: string;
      groupId: string | null;
      groupLabel: string;
      metrics: Record<string, number>;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const values = rows.map(
      (row) => sql`(current_tenant_id(), ${reportName}, ${row.branchId}::uuid,
                    ${row.localDate}::date, ${row.groupKind},
                    ${row.groupId}::uuid, ${row.groupLabel},
                    ${JSON.stringify(row.metrics)}::jsonb,
                    ${runAt.toISOString()}::timestamptz)`,
    );

    await tx.execute(sql`
      insert into report_snapshots
        (tenant_id, report_name, branch_id, bucket_date, group_kind, group_id, group_label,
         metrics, computed_at)
      values ${sql.join(values, sql`, `)}
      on conflict (tenant_id, report_name, branch_id, bucket_date, group_kind,
                   coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do update set metrics = excluded.metrics,
                    group_label = excluded.group_label,
                    computed_at = excluded.computed_at
    `);
  }

  /**
   * Snapshot'tan doluluğun günlük satırları.
   *
   * `OccupancyService.group` ile birlikte kullanılır; canlı yolun kullandığı
   * toplayıcının AYNISI. Testte iki yolun eşitliği bu yüzden anlamlı: sayıyı
   * üreten sorgu da, toplayan kod da tek.
   */
  async readOccupancyDaily(
    period: Period,
    tx?: Tx,
  ): Promise<Awaited<ReturnType<OccupancyService['daily']>>> {
    const run = async (handle: Tx): Promise<{ rows: Record<string, unknown>[] }> =>
      handle.execute<Record<string, unknown>>(sql`
        select s.branch_id, b.name as branch_name,
               s.group_id as staff_profile_id, s.group_label as staff_name,
               s.bucket_date::text as local_date,
               (s.metrics->>'bookedMinutes')::int    as booked_minutes,
               (s.metrics->>'availableMinutes')::int as available_minutes
          from report_snapshots s
          join branches b on b.id = s.branch_id
         where s.report_name = 'occupancy'
           and s.group_kind = 'staff'
           and s.bucket_date >= ${SnapshotService.day(period.from)}::date
           and s.bucket_date <  ${SnapshotService.day(period.to)}::date + 1
         order by s.bucket_date, s.group_label
      `);

    const result = tx === undefined ? await this.tx.run(run) : await run(tx);

    return result.rows.map((row) => ({
      branchId: row.branch_id as string,
      branchName: String(row.branch_name),
      staffProfileId: row.staff_profile_id as string,
      staffName: String(row.staff_name),
      localDate: String(row.local_date),
      bookedMinutes: Number(row.booked_minutes ?? 0),
      availableMinutes: Number(row.available_minutes ?? 0),
    }));
  }

  /**
   * Kovaların gün anahtarı.
   *
   * UTC günü — şubenin yerel günü değil. İkisi bir gün kayabilir ama süpürme
   * damgaya baktığı için bu kayma artık zararsız: bandın içinde kalan ama bu
   * koşuşta yazılmamış bir satır zaten bayattır ve düşmelidir.
   */
  private static day(instant: Date): string {
    return instant.toISOString().slice(0, 10);
  }
}
