import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';

export interface PurgeJob {
  slug: string;
  reason: string;
}

/**
 * Yayın sonrası web istemcisinin tag cache'ini düşürür.
 *
 * ⚠️ Bu worker GEREKLİ DEĞİL, HIZLANDIRICI. Purge hiç ulaşmasa bile public
 * sayfa doğru içeriğe döner: `GET /public/sites/:slug` `s-maxage=300` +
 * `stale-while-revalidate=600` diyor, yani bayatlık beş dakikayla sınırlı.
 * Bu yüzden başarısızlık yayını BOZMAZ — iş kuyruğa yayınla aynı
 * transaction'da yazılıyor ama çalışması ayrı; web ayakta değilse pg-boss
 * geri çekilerek dener, tükenirse satır orada kalır ve TTL devreye girer.
 *
 * `WEB_REVALIDATE_URL` boşken hiç denemiyor: API tek başına da (web istemcisi
 * olmadan, testlerde, yalnız-API dağıtımında) koşabilmeli ve o durumda her
 * yayın bir retry fırtınası üretmemeli.
 */
@Injectable()
export class BookingPagePurgeWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.BOOKING_PAGE_PURGE, async (jobs) => {
      for (const job of jobs) await this.purge(job.data as PurgeJob);
    });
  }

  async purge(job: PurgeJob): Promise<void> {
    const url = this.config.get('WEB_REVALIDATE_URL', { infer: true });
    if (url === '') {
      this.logger.debug({ slug: job.slug }, 'purge atlandı: WEB_REVALIDATE_URL boş');
      return;
    }

    const secret = this.config.get('WEB_REVALIDATE_SECRET', { infer: true }) ?? '';
    const timeout = this.config.get('WEB_REVALIDATE_TIMEOUT_MS', { infer: true });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-klinara-revalidate-secret': secret,
      },
      body: JSON.stringify({ slug: job.slug, reason: job.reason }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      // Fırlatmak pg-boss'un geri çekilmeli yeniden denemesini tetikliyor.
      // Yutmak, "cache düştü" diye sessizce yanlış bilmek olurdu.
      throw new Error(`Purge başarısız: ${response.status} ${url}`);
    }
    this.logger.info({ slug: job.slug, reason: job.reason }, 'randevu sayfası cache’i düşürüldü');
  }
}
