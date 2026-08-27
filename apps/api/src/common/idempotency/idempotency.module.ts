import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Global: idempotency yalnız randevunun değil, Faz 5 (paket satışı) ve
 * Faz 6 (tahsilat) uçlarının da ihtiyacı. Her modülün ayrı import etmesi
 * yerine tek yerden sağlanır.
 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
