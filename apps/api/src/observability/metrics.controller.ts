import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/auth.decorators';
import { MetricsService } from './metrics.service';
import { MetricsTokenGuard } from './metrics-token.guard';

@Controller('metrics')
// İzleme sistemi bu ucu sık çağırır; hız sınırının dışındadır.
@SkipThrottle()
// Prometheus kiracı JWT'si taşıyamaz; bu uç kendi bearer token'ıyla
// (METRICS_TOKEN) korunur — bkz. MetricsTokenGuard.
@Public()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @UseGuards(MetricsTokenGuard)
  // İç metrikler genel API sözleşmesinin parçası değildir; dokümanda görünmez.
  @ApiExcludeEndpoint()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
