import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { SnapshotService } from './snapshot.service';

interface TenantJob {
  tenantId: string;
}

/**
 * Yenilenen geriye dönük pencere.
 *
 * Yalnız DÜNÜ yazmak yetmez: geç girilen bir tahsilat, geri alınan bir iptal
 * ya da elle düzeltilen bir randevu geçmiş bir günün sayısını değiştirir. 35
 * gün, "geçen ay" raporunun tamamını kapsayan ve gece işini birkaç saniyede
 * bitiren aralık.
 */
export const SNAPSHOT_WINDOW_DAYS = 35;

/**
 * Rapor özetlerini geceleri yenileyen süpürücü.
 *
 * `package-expiry.worker.ts`in iki adımlı kalıbı: cron `sweep`i tetikler, o da
 * kiracı başına bir iş yazar. Tek job'da tüm kiracıları gezmek, bir kiracıdaki
 * hatanın diğerlerini de durdurması demekti.
 *
 * ⚠️ Bu job GERÇEĞİN KAYNAĞI DEĞİL. Raporlar snapshot olmadan da doğru çalışır
 * — canlı sorgu yolu her zaman açık ve testlerin ölçtüğü o. Snapshot yalnız
 * hızlandırıcıdır; job hiç koşmasa raporlar yavaşlar, YANLIŞ OLMAZ. Bu, kuyruk
 * kapalıyken (`QUEUE_ENABLED=false`) hiçbir şeyin bozulmamasının da sebebi.
 */
@Injectable()
export class SnapshotWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    private readonly snapshots: SnapshotService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.REPORT_SNAPSHOT_SWEEP, async () => {
      await this.sweep();
    });
    this.queue.register(QUEUES.REPORT_SNAPSHOT_TENANT, async (jobs) => {
      for (const job of jobs) await this.handle(job.data as TenantJob);
    });
  }

  /** Aktif kiracıları listeler ve her biri için ayrı bir iş yazar. */
  async sweep(): Promise<number> {
    const tenantIds = await this.tx.runAsSystem(async (tx) => {
      // `status <> 'suspended'` — `= 'active'` DEĞİL. Deneme sürümündeki bir
      // kiracı (`trial`, varsayılan durum) da rapor bakıyor; onu dışarıda
      // bırakmak, ürünü değerlendiren kişiye boş rapor göstermek olurdu.
      // Askıya alınmış kiracının raporu ise kimseye lazım değil.
      const result = await tx.execute<{ id: string }>(sql`
        select id from tenants where status <> 'suspended'
      `);
      return result.rows.map((row) => row.id);
    });

    for (const tenantId of tenantIds) {
      await this.tx.runForTenant(tenantId, async (tx) => {
        await this.queue.send(
          tx,
          QUEUES.REPORT_SNAPSHOT_TENANT,
          { tenantId },
          { singletonKey: `report-snapshot:${tenantId}` },
        );
      });
    }

    this.logger.info({ tenants: tenantIds.length }, 'Rapor özeti yenilemesi kuyruklandı');
    return tenantIds.length;
  }

  /** Tek kiracının son `SNAPSHOT_WINDOW_DAYS` gününü yeniden yazar. */
  async handle(job: TenantJob, now = new Date()): Promise<number> {
    const to = now;
    const from = new Date(now.getTime() - SNAPSHOT_WINDOW_DAYS * 86_400_000);

    // Bağlamı `runForTenant` kuruyor, hesabı servis yapıyor: worker'ın istek
    // bağlamı olmadığı için transaction'ı servise GEÇİRMEK zorunda.
    const written = await this.tx.runForTenant(job.tenantId, async (tx) =>
      this.snapshots.refresh({ from, to }, tx),
    );

    this.logger.info({ tenantId: job.tenantId, rows: written }, 'Rapor özeti yenilendi');
    return written;
  }
}
