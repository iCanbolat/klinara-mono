import { Global, Module } from '@nestjs/common';
import { RealtimeBusService } from './realtime-bus.service';

/**
 * Yayın yolu GLOBAL bir modüldür: olay yazımı tek modülde toplanmıyor
 * (kuyrukla aynı gerekçe). Soket tarafı `modules/realtime`'da.
 */
@Global()
@Module({
  providers: [RealtimeBusService],
  exports: [RealtimeBusService],
})
export class RealtimeBusModule {}
