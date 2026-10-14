import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import * as repo from './booking-page.repository';

/**
 * web-booking'in tag cache'ini düşürecek purge işini kuyruğa yazar.
 *
 * Randevu sayfasının sunucu kabuğu (site + katalog) ISR'la beş dakika tutuluyor.
 * Yalnız yayın purge yazsaydı, personelin hizmet/şube ataması, hizmet ve şube
 * düzenlemesi ya da sayfa ayarı değişikliği o beş dakika boyunca görünmezdi —
 * klinik "kaydettim ama sayfada yok" der ve sert yenilemeye kadar haklıdır.
 *
 * Aynı `singletonKey` sayesinde art arda gelen yazımlar tek bir purge'e
 * katlanıyor; ekranda on alan değiştiren kullanıcı web'e on istek atmıyor.
 */
@Injectable()
export class BookingPageCacheService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly queue: QueueService,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * İşi ÇAĞIRANIN transaction'ına yazar: yazım geri alınırsa purge de yazılmaz.
   */
  async schedule(tx: Tx, slug: string, reason: string): Promise<void> {
    await this.queue.send(
      tx,
      QUEUES.BOOKING_PAGE_PURGE,
      { slug, reason },
      { singletonKey: `purge:${slug}`, retryLimit: 5, retryBackoff: true, expireInSeconds: 120 },
    );
  }

  /**
   * Yazım COMMIT edildikten sonra, kendi transaction'ında purge planlar.
   *
   * Asıl yazım zaten kalıcı; purge yalnız hızlandırıcı (TTL yine devrede).
   * Burada fırlatmak, başarılı bir kaydı kullanıcıya hata olarak gösterirdi —
   * bu yüzden hata yutulup loglanıyor. Sayfası hiç açılmamış kiracıda yapacak
   * bir şey yok.
   */
  async invalidate(reason: string): Promise<void> {
    try {
      await this.tx.run(async (tx) => {
        const site = await repo.findSite(tx);
        if (site === undefined) return;
        await this.schedule(tx, site.slug, reason);
      });
    } catch (error: unknown) {
      this.logger.warn({ err: error, reason }, 'randevu sayfası purge planlanamadı');
    }
  }
}
