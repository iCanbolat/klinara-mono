import { Global, Module } from '@nestjs/common';
import { PlatformAccessLogService } from './platform-access-log.service';

/**
 * `PlatformAdminGuard` uçlarda `@UseGuards` ile kuruluyor; bağımlılığının her
 * modülden çözülebilmesi için erişim kaydı servisi global.
 */
@Global()
@Module({
  providers: [PlatformAccessLogService],
  exports: [PlatformAccessLogService],
})
export class PlatformAccessModule {}
