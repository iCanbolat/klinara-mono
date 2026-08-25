import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import pg from 'pg';
import { PG_POOL } from '../../database/database.constants';
import { currentMigrationVersion } from '../../database/migrate';
import { HealthResponseDto, ReadinessResponseDto } from './dto/health-response.dto';

@ApiTags('system')
@Controller()
// Sağlık uçları izleme sistemleri tarafından sık çağrılır; sınırlama dışı.
@SkipThrottle()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /**
   * Liveness — "süreç ayakta mı?".
   *
   * Kasıtlı olarak hiçbir bağımlılığı (DB, kuyruk) kontrol ETMEZ. Bu ucun görevi
   * orkestratöre süreci yeniden başlatması gerekip gerekmediğini söylemektir;
   * DB'nin düşmesi süreci yeniden başlatmakla düzelmez.
   */
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness kontrolü' })
  @ApiOkResponse({ type: HealthResponseDto })
  liveness(): HealthResponseDto {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * Readiness — "bu instance trafik alabilir mi?".
   *
   * `/healthz`ten farkı: bağımlılıkları GERÇEKTEN yoklar. DB düştüğünde bu uç 503
   * döner, load balancer instance'ı havuzdan çıkarır ama süreç yeniden
   * başlatılmaz — bağlantı geri geldiğinde kendiliğinden trafiğe döner.
   */
  @Get('readyz')
  @ApiOperation({ summary: 'Readiness kontrolü (DB + migration sürümü)' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ description: 'Bağımlılıklardan biri erişilemez durumda' })
  async readiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponseDto> {
    try {
      const migrationVersion = await currentMigrationVersion(this.pool);
      return { status: 'ready', checks: { database: 'up' }, migrationVersion };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'not_ready', checks: { database: 'down' }, migrationVersion: null };
    }
  }
}
