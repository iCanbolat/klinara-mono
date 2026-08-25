import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsTokenGuard } from './metrics-token.guard';
import { MetricsService } from './metrics.service';

/**
 * İş metrikleri her modülden erişilebilir olmalı (randevu, çakışma, bildirim
 * sayaçları); bu yüzden global.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsTokenGuard,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
