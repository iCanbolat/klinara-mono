import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import {
  RequireAnyPermission,
  RequirePermission,
} from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import {
  NoShowQueryDto,
  NoShowReportDto,
  OccupancyQueryDto,
  OccupancyReportDto,
  RetentionQueryDto,
  RetentionReportDto,
  RevenueQueryDto,
  RevenueReportDto,
  StaffPerformanceQueryDto,
  StaffPerformanceReportDto,
} from './dto/report.dto';
import { OccupancyService } from './occupancy.service';
import { PerformanceService } from './performance.service';
import { RevenueService } from './revenue.service';

/**
 * Batch 10.1 raporları.
 *
 * İzinler rapor rapor seçildi, tek bir "rapor okuma" izni altında toplanmadı:
 * doluluk ve no-show operasyonel sayılardır ve resepsiyon onları görmeli, ciro
 * ise görmemeli. Tek izin, ikisini birlikte açıp kapatmaya zorlardı.
 */
@ApiTags('reports')
@ApiBearerAuth('bearerAuth')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly occupancy: OccupancyService,
    private readonly revenue: RevenueService,
    private readonly performance: PerformanceService,
  ) {}

  @Get('occupancy')
  @RequireAnyPermission(PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN)
  @ApiOperation({
    summary: 'Doluluk oranı — personel/şube/gün kırılımıyla',
    description:
      'Payda personelin GERÇEKTEN müsait olduğu dakikalar: vardiya ∩ şube saatleri, ' +
      'eksi mola, tatil ve izinler. Pay `resource_bookings` üzerindeki işgal ve ' +
      'buffer\'ları İÇERİR. Mesai dışı randevu varsa oran 100\'ü aşabilir.',
  })
  @ApiOkResponse({ type: OccupancyReportDto })
  occupancyReport(
    @CurrentUser() principal: Principal,
    @Query() query: OccupancyQueryDto,
  ): Promise<OccupancyReportDto> {
    return this.occupancy.report(principal, query);
  }

  @Get('revenue')
  @RequirePermission(PERMISSIONS.REPORT_REVENUE_READ)
  @ApiOperation({
    summary: 'Ciro — tahakkuk eden ve tahsil edilen ayrı ayrı',
    description:
      'Tahakkuk: pencerede AÇILAN ücret kalemleri. Tahsilat: pencerede YAPILAN, ' +
      'iptal edilmemiş tahsilatlar. İkisi aynı sayı değildir. Kırılım satırlarının ' +
      'tahsilat toplamı genel toplamdan küçük olabilir: eski bir borca yapılan ' +
      'tahsilatın bağlanacağı kalem bu pencerede değildir.',
  })
  @ApiOkResponse({ type: RevenueReportDto })
  revenueReport(
    @CurrentUser() principal: Principal,
    @Query() query: RevenueQueryDto,
  ): Promise<RevenueReportDto> {
    return this.revenue.report(principal, query);
  }

  @Get('staff-performance')
  @RequireAnyPermission(PERMISSIONS.REPORT_REVENUE_READ, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN)
  @ApiOperation({
    summary: 'Personel performansı — işlem, ciro, prim, doluluk',
    description:
      'Yalnız `report.performance:read.own` taşıyan bir çağıran KENDİ satırına ' +
      'kilitlenir; gönderdiği `staffProfileId` yok sayılır ve yanıt `scope: "own"` ' +
      'döner. Ciro `charges` üzerinden okunur (indirim, override ve KDV orada), ' +
      'kalem fiyatından değil.',
  })
  @ApiOkResponse({ type: StaffPerformanceReportDto })
  staffPerformanceReport(
    @CurrentUser() principal: Principal,
    @Query() query: StaffPerformanceQueryDto,
  ): Promise<StaffPerformanceReportDto> {
    return this.performance.staffPerformance(principal, query);
  }

  @Get('no-show')
  @RequirePermission(PERMISSIONS.APPOINTMENT_READ_ALL)
  @ApiOperation({
    summary: 'No-show ve iptal oranı',
    description:
      'Grain RANDEVUDUR, hizmet değil: gelmeyen bir müşteri, randevusunda üç ' +
      'hizmet olduğu için üç no-show sayılmaz. `byOrigin` online ve iç randevuyu ' +
      'ayırır.',
  })
  @ApiOkResponse({ type: NoShowReportDto })
  noShowReport(
    @CurrentUser() principal: Principal,
    @Query() query: NoShowQueryDto,
  ): Promise<NoShowReportDto> {
    return this.performance.noShow(principal, query);
  }

  @Get('retention')
  @RequirePermission(PERMISSIONS.APPOINTMENT_READ_ALL)
  @ApiOperation({
    summary: 'Müşteri kazanım ve geri dönüş',
    description:
      '"Yeni müşteri" kayıt tarihine değil, İLK TAMAMLANMIŞ randevusuna göre ' +
      'sayılır. Kohort oranları pencere bugüne yakınsa düşük görünür: kimsenin ' +
      '90 günü henüz dolmamıştır. Yanıt müşteri KİMLİĞİ taşımaz.',
  })
  @ApiOkResponse({ type: RetentionReportDto })
  retentionReport(
    @CurrentUser() principal: Principal,
    @Query() query: RetentionQueryDto,
  ): Promise<RetentionReportDto> {
    return this.performance.retention(principal, query);
  }
}
