import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';

interface TenantJob {
  tenantId: string;
}

/** Kilitlenip işlenecek kalem sayısı — uzun transaction açmamak için. */
const BATCH_SIZE = 500;

/**
 * Geçerlilik süresi dolan paketleri kapatan süpürücü.
 *
 * İki adım: cron `sweep`i tetikler, o da kiracı başına bir `tenant` işi yazar.
 * Tek job'da tüm kiracıları gezmek, bir kiracıdaki hatanın diğerlerini de
 * durdurması demekti.
 *
 * ⚠️ Bu job GERÇEĞİN KAYNAĞI DEĞİL, bir süpürücüdür. Gece 03:15'te koşarken
 * saat 09:00'da süresi dolmuş bir paketten tüketim yine de reddedilir; kuralı
 * `package_ledger_validate_scope()` trigger'ı (K0005) zorlar.
 *
 * İDEMPOTENT: ikinci koşuşta paketler artık `active` değil ve kalan hak 0
 * olduğu için sorgu satır bulmaz. İdempotence VERİDEN gelir, job'tan değil —
 * `singletonKey` yalnız gereksiz işi engeller.
 */
@Injectable()
export class PackageExpiryWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.PACKAGE_EXPIRE_SWEEP, async () => {
      await this.sweep();
    });
    this.queue.register(QUEUES.PACKAGE_EXPIRE_TENANT, async (jobs) => {
      for (const job of jobs) await this.handle(job.data as TenantJob);
    });
  }

  /** Kiracıları listeler ve her biri için ayrı bir iş yazar. */
  async sweep(): Promise<number> {
    const tenantIds = await this.tx.runAsSystem(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        select id from tenants where status = 'active'
      `);
      return result.rows.map((row) => row.id);
    });

    for (const tenantId of tenantIds) {
      await this.tx.runForTenant(tenantId, async (tx) => {
        await this.queue.send(
          tx,
          QUEUES.PACKAGE_EXPIRE_TENANT,
          { tenantId },
          { singletonKey: `pkg-expire:${tenantId}` },
        );
      });
    }

    this.logger.info({ tenants: tenantIds.length }, 'Paket süre dolumu süpürmesi kuyruklandı');
    return tenantIds.length;
  }

  /** Tek kiracının süresi dolmuş paketlerini kapatır. */
  async handle(job: TenantJob): Promise<number> {
    let closed = 0;

    for (;;) {
      const batch = await this.tx.runForTenant(job.tenantId, async (tx) => {
        // `skip locked`: eş zamanlı bir tüketim kalemi kilitlemişse o satır bu
        // turda atlanır, job bloke olmaz. `delta` kilit altında okunan
        // değerden hesaplandığı için yarış da yok.
        const due = await tx.execute<{ id: string; package_id: string; remaining: number }>(sql`
          select i.id, i.customer_package_id as package_id, i.remaining_sessions as remaining
            from customer_package_items i
            join customer_packages p on p.id = i.customer_package_id
           where p.status = 'active'
             and p.deleted_at is null
             and p.expires_at is not null
             and p.expires_at <= now()
             and i.remaining_sessions > 0
           order by i.id
           limit ${BATCH_SIZE}
             for update of i skip locked
        `);

        for (const row of due.rows) {
          await tx.execute(sql`
            insert into package_ledger_entries
              (tenant_id, customer_package_id, customer_package_item_id, entry_type, delta, reason)
            values (${job.tenantId}::uuid, ${row.package_id}::uuid, ${row.id}::uuid,
                    'expire', ${-Number(row.remaining)},
                    'Geçerlilik süresi doldu (otomatik)')
          `);
        }
        return due.rows.length;
      });

      closed += batch;
      if (batch < BATCH_SIZE) break;
    }

    // Kalan hakkı kalmayan ama hâlâ `active` görünen paketleri kapat. Ayrı
    // adım olmasının sebebi: hiç kalemi kalmamış (kalan 0) süresi dolmuş
    // paketler de kapanmalı, yukarıdaki döngü onlara hiç uğramaz.
    const expired = await this.tx.runForTenant(job.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        update customer_packages
           set status = 'expired'
         where status = 'active'
           and deleted_at is null
           and expires_at is not null
           and expires_at <= now()
      `);
      return result.rowCount ?? 0;
    });

    if (closed > 0 || expired > 0) {
      this.logger.info(
        { tenantId: job.tenantId, items: closed, packages: expired },
        'Paket süre dolumu uygulandı',
      );
    }
    return expired;
  }
}
