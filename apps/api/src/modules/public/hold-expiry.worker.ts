import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { AvailabilityCacheService } from '../booking/availability-cache.service';
import * as repo from './holds.repository';

interface TenantJob {
  tenantId: string;
}

/**
 * Süresi dolan tutmaları serbest bırakır.
 *
 * ⚠️ Bu worker GERÇEĞİN KAYNAĞI DEĞİL, bir SÜPÜRÜCÜDÜR. Süresi dolmuş bir
 * tutma, worker hiç koşmasa bile randevuya dönüşemez: `expires_at` her
 * okumada kontrol ediliyor (`PublicBookingService.requireHold`) ve tutma
 * yazılmadan önce de eskiler temizleniyor. Kuyruk kapalı bir ortamda
 * (`QUEUE_ENABLED=false`) akış yine doğru çalışır — bu, Faz 8'deki hatırlatma
 * kararının aynısı.
 *
 * Worker'ın işi, süresi dolmuş bir tutmanın uygunluk sorgusunda gereksiz yere
 * yer kaplamamasını sağlamak: kimse o slota bakmasa bile serbest kalmalı.
 */
@Injectable()
export class HoldExpiryWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    private readonly cache: AvailabilityCacheService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.BOOKING_HOLD_SWEEP, async () => {
      await this.sweep();
    });
    this.queue.register(QUEUES.BOOKING_HOLD_EXPIRE, async (jobs) => {
      for (const job of jobs) await this.expireForTenant((job.data as TenantJob).tenantId);
    });
  }

  async sweep(): Promise<number> {
    const tenantIds = await this.tx.runAsSystem(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        select id from tenants where status in ('trial', 'active') and deleted_at is null
      `);
      return result.rows.map((row) => row.id);
    });

    for (const tenantId of tenantIds) {
      await this.tx.runForTenant(tenantId, async (tx) => {
        await this.queue.send(
          tx,
          QUEUES.BOOKING_HOLD_EXPIRE,
          { tenantId },
          { singletonKey: `hold-expire:${tenantId}` },
        );
      });
    }
    return tenantIds.length;
  }

  async expireForTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    const expired = await this.tx.runForTenant(tenantId, (tx) => repo.expireStaleHolds(tx, now));
    if (expired > 0) {
      // Serbest kalan slotlar bir sonraki sorguda görünmeli.
      this.cache.invalidateTenant(tenantId);
      this.logger.info({ tenantId, expired }, 'Süresi dolan slot tutmaları serbest bırakıldı');
    }
    return expired;
  }
}
