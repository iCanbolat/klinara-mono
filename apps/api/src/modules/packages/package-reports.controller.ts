import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { PackageReportsService } from './package-reports.service';
import {
  ExpiringReportDto,
  ExpiringReportQueryDto,
  OutstandingReportDto,
  OutstandingReportQueryDto,
  UsageReportDto,
  UsageReportQueryDto,
} from './dto/package-report.dto';

/**
 * Paket raporları.
 *
 * Faz 6 ve 10.1 kardeş controller'ları getirdiğinde ayrı bir `ReportingModule`e
 * taşınabilir; şimdiden ayrı modül açmak boş bir kabuk olurdu.
 */
@ApiTags('reports')
@ApiBearerAuth('bearerAuth')
@Controller('reports/packages')
export class PackageReportsController {
  constructor(private readonly reports: PackageReportsService) {}

  @Get('outstanding')
  @RequirePermission(PERMISSIONS.REPORT_REVENUE_READ)
  @ApiOperation({
    summary: 'Taşınan yükümlülük — satılmış ama kullanılmamış seansların karşılığı',
    description:
      'Tutar SATIŞ ANINDAKİ tahsisten hesaplanır, güncel katalog fiyatından değil.',
  })
  @ApiOkResponse({ type: OutstandingReportDto })
  outstanding(@Query() query: OutstandingReportQueryDto): Promise<OutstandingReportDto> {
    return this.reports.outstanding(query);
  }

  @Get('expiring')
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({
    summary: 'Yaklaşan süre dolumu',
    description:
      'Aralık yarı açıktır: `[from, to)`. Parasal alanlar yalnız `report.revenue:read` izniyle döner.',
  })
  @ApiOkResponse({ type: ExpiringReportDto })
  expiring(
    @CurrentUser() principal: Principal,
    @Query() query: ExpiringReportQueryDto,
  ): Promise<ExpiringReportDto> {
    return this.reports.expiring(principal, query);
  }

  @Get('usage')
  @RequirePermission(PERMISSIONS.PACKAGE_READ)
  @ApiOperation({
    summary: 'Dönem kullanımı — satılan, tüketilen, iade, süre dolumu',
    description: 'Defterden hesaplanır; ters kayıtlar toplamdan otomatik düşer.',
  })
  @ApiOkResponse({ type: UsageReportDto })
  usage(@Query() query: UsageReportQueryDto): Promise<UsageReportDto> {
    return this.reports.usage(query);
  }
}
