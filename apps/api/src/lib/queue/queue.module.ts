import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Kuyruk GLOBAL bir modüldür: iş yazımı tek bir modülde toplanmıyor
 * (dosya thumbnail'i, Faz 8 hatırlatmaları, Faz 5 paket süre dolumu).
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
