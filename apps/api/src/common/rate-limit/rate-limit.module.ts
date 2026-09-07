import { Module } from '@nestjs/common';
import { PgThrottlerStorage } from './pg-throttler.storage';

/**
 * Hız sınırı deposu, `ThrottlerModule.forRootAsync`in fabrikasına enjekte
 * edilebilsin diye ayrı bir modülde duruyor: `AppModule`in providers listesine
 * konsaydı, kendi kurulumu sırasında ihtiyaç duyulan bir bağımlılık olurdu.
 */
@Module({
  providers: [PgThrottlerStorage],
  exports: [PgThrottlerStorage],
})
export class RateLimitModule {}
