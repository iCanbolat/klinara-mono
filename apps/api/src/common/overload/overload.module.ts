import { Global, Module } from '@nestjs/common';
import { OverloadMetricsService } from './overload-metrics.service';
import { OverloadService } from './overload.service';

/**
 * Aşırı yük ölçümü tek bir örnektir ve hem guard hem de metrikler tarafından
 * okunur; bu yüzden global.
 */
@Global()
@Module({
  providers: [OverloadService, OverloadMetricsService],
  exports: [OverloadService],
})
export class OverloadModule {}
