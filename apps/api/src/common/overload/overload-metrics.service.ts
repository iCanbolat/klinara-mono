import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MetricsService } from '../../observability/metrics.service';
import { OverloadService } from './overload.service';

/** Aşırı yük ölçümünü `/metrics`e bağlar (Batch 10.3). */
@Injectable()
export class OverloadMetricsService implements OnModuleInit {
  constructor(
    private readonly overload: OverloadService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.setOverloadSampler((gauge) => {
      const snapshot = this.overload.current;
      gauge.set({ signal: 'event_loop_delay_ms' }, snapshot.eventLoopDelayMs);
      gauge.set({ signal: 'heap_used_ratio' }, snapshot.heapUsedRatio);
      gauge.set({ signal: 'active' }, snapshot.overloaded ? 1 : 0);
    });
  }
}
