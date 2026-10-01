import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Panelin anlık olay soketi. Olayların YAZIMI burada değil: modüller
 * `RealtimeBusService.publish`i (global) kendi transaction'larında çağırır.
 */
@Module({
  imports: [IdentityModule],
  controllers: [RealtimeController],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
