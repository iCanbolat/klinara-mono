import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES, PERMISSIONS } from '@klinara/shared';
import {
  RequireAnyPermission,
  RequirePermission,
} from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppError } from '../../common/errors/app-error';
import type { Principal } from '../identity/principal';
import { csvFilename } from './csv';
import {
  NoShowQueryDto,
  OccupancyQueryDto,
  RetentionQueryDto,
  RevenueQueryDto,
  StaffPerformanceQueryDto,
} from './dto/report.dto';
import { OccupancyService } from './occupancy.service';
import { PerformanceService } from './performance.service';
import {
  noShowCsv,
  occupancyCsv,
  retentionCsv,
  revenueCsv,
  staffPerformanceCsv,
} from './report-csv';
import { RevenueService } from './revenue.service';

/**
 * CSV dışa aktarım.
 *
 * `POST` — ama hiçbir şey YAZMIYOR. Gövde bir kayıt değil bir filtre; `GET`
 * olsaydı aynı filtre sorgu dizgesine sığmazdı ve daha önemlisi rapor
 * parametreleri (tarih aralığı, şube) sunucu erişim loglarına ve tarayıcı
 * geçmişine düşerdi. Doküman da bu ucu `POST` olarak tanımlıyor.
 *
 * Her rapor AYRI bir metot, `:name` parametresi YOK. Dinamik bir yol
 * parametresi izni de dinamik yapardı; `@RequirePermission` statik olduğu için
 * her uç kendi iznini derleme zamanında taşıyor ve "her endpoint bir izin
 * kontrolüne bağlı" CI testi bunları da görüyor.
 */
@ApiTags('reports')
@ApiBearerAuth('bearerAuth')
@Controller('reports')
export class ReportExportController {
  constructor(
    private readonly occupancy: OccupancyService,
    private readonly revenue: RevenueService,
    private readonly performance: PerformanceService,
  ) {}

  @Post('occupancy/export')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Doluluk raporunu CSV olarak indir' })
  async occupancyExport(
    @CurrentUser() principal: Principal,
    @Body() query: OccupancyQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.occupancy.report(principal, query);
    return send(response, 'doluluk', query, occupancyCsv(report), report.data.length);
  }

  @Post('revenue/export')
  @RequirePermission(PERMISSIONS.REPORT_REVENUE_READ)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Ciro raporunu CSV olarak indir' })
  async revenueExport(
    @CurrentUser() principal: Principal,
    @Body() query: RevenueQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.revenue.report(principal, query);
    return send(response, 'ciro', query, revenueCsv(report), report.data.length);
  }

  @Post('staff-performance/export')
  @RequireAnyPermission(PERMISSIONS.REPORT_REVENUE_READ, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Personel performansını CSV olarak indir' })
  async staffPerformanceExport(
    @CurrentUser() principal: Principal,
    @Body() query: StaffPerformanceQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.performance.staffPerformance(principal, query);
    return send(response, 'personel-performans', query, staffPerformanceCsv(report), report.data.length);
  }

  @Post('no-show/export')
  @RequirePermission(PERMISSIONS.APPOINTMENT_READ_ALL)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'No-show raporunu CSV olarak indir' })
  async noShowExport(
    @CurrentUser() principal: Principal,
    @Body() query: NoShowQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.performance.noShow(principal, query);
    return send(response, 'gelmeme', query, noShowCsv(report), report.data.length);
  }

  @Post('retention/export')
  @RequirePermission(PERMISSIONS.APPOINTMENT_READ_ALL)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Kazanım kaynağı kırılımını CSV olarak indir',
    description: 'Dosya kazanım kaynaklarını taşır; kohort oranları ekranda kalır.',
  })
  async retentionExport(
    @CurrentUser() principal: Principal,
    @Body() query: RetentionQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.performance.retention(principal, query);
    return send(response, 'kazanim', query, retentionCsv(report), report.acquisition.length);
  }
}

/**
 * Satır üst sınırı.
 *
 * Akış (streaming) yok ve bu sınırla gerek de yok: 50 bin satırlık bir CSV
 * birkaç megabayt, belleğe sığar. Sınırı aşan bir istek sessizce yavaşlamak
 * yerine "aralığı daraltın" diyor — bir rapor dosyası bekleyen kullanıcı için
 * zaman aşımına düşen bir istek, açık bir hatadan çok daha kötü.
 */
export const REPORT_EXPORT_MAX_ROWS = 50_000;

function send(
  response: Response,
  reportName: string,
  query: { from: string; to: string },
  body: string,
  rowCount: number,
): string {
  if (rowCount > REPORT_EXPORT_MAX_ROWS) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Rapor çok büyük', {
      detail: `Dışa aktarım en fazla ${REPORT_EXPORT_MAX_ROWS} satır taşıyabilir; tarih aralığını daraltın ya da şube seçin.`,
    });
  }

  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${csvFilename(reportName, query.from, query.to)}"`,
  );
  // Rapor kiracıya özel ve zamana bağlı; hiçbir ara katman saklamamalı.
  response.setHeader('Cache-Control', 'no-store');
  return body;
}
