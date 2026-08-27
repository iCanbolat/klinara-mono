import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import sharp from 'sharp';
import { customerFiles } from '../../database/schema';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../lib/storage/storage.types';

interface ThumbnailJob {
  fileId: string;
  tenantId: string;
}

const THUMBNAIL_MAX_EDGE = 400;
const THUMBNAIL_MIME = 'image/webp';

/**
 * Küçük görsel üretimi.
 *
 * Neden kuyrukta: dosya içeriği API sürecinden geçmiyor, yani küçültme
 * yükleme isteğinin içinde yapılamaz. Worker nesneyi S3'ten indirir, küçültür,
 * geri yazar ve satıra `thumbnail_key` işler.
 *
 * Aynı turda dosyanın **sha256 beyanı** da doğrulanıyor: nesne zaten indirildi,
 * ikinci bir okuma maliyeti yok. Uyuşmazlıkta satır `pending`e düşer — dosya
 * listede kalır ama "hazır" saymayan hiçbir akış onu kullanmaz.
 */
@Injectable()
export class ThumbnailWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    private readonly logger: PinoLogger,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.CUSTOMER_FILE_THUMBNAIL, async (jobs) => {
      for (const job of jobs) await this.handle(job.data as ThumbnailJob);
    });
  }

  async handle(job: ThumbnailJob): Promise<void> {
    // İş kimliklerden ibaret; içerik HER ZAMAN işin kendi transaction'ında,
    // kiracı context'i altında okunuyor.
    const file = await this.tx.runForTenant(job.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(customerFiles)
        .where(eq(customerFiles.id, job.fileId))
        .limit(1);
      return row;
    });

    if (file === undefined) {
      // Kayıt rollback olmuş ya da silinmiş: iş sessizce biter.
      this.logger.debug({ fileId: job.fileId }, 'Küçük görsel: dosya kaydı yok');
      return;
    }
    if (file.thumbnailKey !== null) return;

    const body = await this.storage.get(file.storageKey);
    if (body === undefined) {
      this.logger.warn({ fileId: file.id }, 'Küçük görsel: nesne bulunamadı');
      return;
    }

    if (file.sha256 !== null) {
      const actual = createHash('sha256').update(body).digest('hex');
      if (actual !== file.sha256) {
        this.logger.error({ fileId: file.id }, 'Dosya özeti uyuşmuyor — kayıt beklemede');
        await this.tx.runForTenant(job.tenantId, async (tx) => {
          await tx
            .update(customerFiles)
            .set({ status: 'pending' })
            .where(eq(customerFiles.id, file.id));
        });
        return;
      }
    }

    const thumbnail = await sharp(body)
      .rotate()
      .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const key = `${file.storageKey}-thumb.webp`;
    await this.storage.put(key, thumbnail, THUMBNAIL_MIME);

    await this.tx.runForTenant(job.tenantId, async (tx) => {
      await tx
        .update(customerFiles)
        .set({ thumbnailKey: key })
        .where(eq(customerFiles.id, file.id));
    });
  }
}
