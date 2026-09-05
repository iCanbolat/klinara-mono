import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  COMPARE_MODES,
  NO_SHOW_GROUPINGS,
  OCCUPANCY_GROUPINGS,
  REVENUE_GROUPINGS,
  type CompareMode,
} from '@klinara/shared';
import { DateRangeQueryDto } from '../../../common/dto/date-range.dto';

// Gruplama demetleri ve karşılaştırma modları `@klinara/shared`te; sunucu ve
// web istemcileri aynı listeden okuyor. Burada yeniden tanımlamak, bir
// kırılımın yalnız bir tarafta var olmasına açık kapı bırakırdı.

/**
 * Her rapor ucunun ortak sorgusu.
 *
 * `branchId` **opsiyonel** ve verilmediğinde "tüm şubeler" DEĞİL, "erişebildiğim
 * şubeler" anlamına gelir (`report-scope.ts`). Ayrım önemli: şube kapsamlı bir
 * kullanıcının parametreyi boş bırakması, kiracının tamamını taramasına yol
 * açmamalı.
 */
export class ReportQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    enum: COMPARE_MODES,
    default: 'none',
    description: 'Hemen önceki, AYNI UZUNLUKTAKİ pencereyle karşılaştırır.',
  })
  @IsOptional()
  @IsIn(COMPARE_MODES)
  compareTo?: CompareMode;
}

export class OccupancyQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: OCCUPANCY_GROUPINGS, default: 'staff' })
  @IsOptional()
  @IsIn(OCCUPANCY_GROUPINGS)
  groupBy?: (typeof OCCUPANCY_GROUPINGS)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;
}

export class RevenueQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: REVENUE_GROUPINGS, default: 'service' })
  @IsOptional()
  @IsIn(REVENUE_GROUPINGS)
  groupBy?: (typeof REVENUE_GROUPINGS)[number];
}

export class StaffPerformanceQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Yalnız kendi verisini görebilen çağıranlarda YOK SAYILIR — daraltma sunucuda.',
  })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;
}

export class NoShowQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: NO_SHOW_GROUPINGS, default: 'staff' })
  @IsOptional()
  @IsIn(NO_SHOW_GROUPINGS)
  groupBy?: (typeof NO_SHOW_GROUPINGS)[number];
}

export class RetentionQueryDto extends ReportQueryDto {}

// ---------------------------------------------------------------------------
// Yanıtlar
// ---------------------------------------------------------------------------

export class ReportPeriodDto {
  @ApiProperty() from: string;
  @ApiProperty({ description: 'HARİÇ' }) to: string;
}

export class OccupancyTotalsDto {
  @ApiProperty() bookedMinutes: number;
  @ApiProperty() availableMinutes: number;
  @ApiProperty({ description: 'Yüzde. Mesai dışı randevu varsa 100 aşabilir.' })
  occupancyRate: number;
}

export class OccupancyRowDto extends OccupancyTotalsDto {
  @ApiProperty({ nullable: true, type: String }) groupId: string | null;
  @ApiProperty() groupLabel: string;
}

export class OccupancyReportDto {
  @ApiProperty({ enum: ['all', 'own'] }) scope: 'all' | 'own';
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: OccupancyTotalsDto }) totals: OccupancyTotalsDto;
  @ApiProperty({ type: [OccupancyRowDto] }) data: OccupancyRowDto[];
  @ApiPropertyOptional({ type: OccupancyTotalsDto }) previous?: OccupancyTotalsDto;
  @ApiPropertyOptional({
    type: Object,
    description: 'Yüzde değişim. `null` = kıyaslanamaz (önceki dönem sıfır).',
  })
  delta?: Record<string, number | null>;
}

export class RevenueTotalsDto {
  @ApiProperty({ description: 'Tahakkuk — açık ücret kalemlerinin toplamı.' })
  accruedMinor: number;
  @ApiProperty({ description: 'Tahsil edilen — iptal edilmemiş tahsilatlar.' })
  collectedMinor: number;
  @ApiProperty() refundedMinor: number;
  @ApiProperty() currency: string;
}

export class RevenueRowDto {
  @ApiProperty({ nullable: true, type: String }) groupId: string | null;
  @ApiProperty() groupLabel: string;
  @ApiProperty() accruedMinor: number;
  @ApiProperty() collectedMinor: number;
}

export class RevenueReportDto {
  @ApiProperty({ enum: ['all', 'own'] }) scope: 'all' | 'own';
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: RevenueTotalsDto }) totals: RevenueTotalsDto;
  @ApiProperty({ type: [RevenueRowDto] }) data: RevenueRowDto[];
  @ApiPropertyOptional({ type: RevenueTotalsDto }) previous?: RevenueTotalsDto;
  @ApiPropertyOptional({ type: Object }) delta?: Record<string, number | null>;
}

export class StaffPerformanceRowDto {
  @ApiProperty({ format: 'uuid' }) staffProfileId: string;
  @ApiProperty() staffName: string;
  @ApiProperty({ description: 'Tamamlanmış randevulardaki hizmet kalemi sayısı.' })
  completedServices: number;
  @ApiProperty() revenueMinor: number;
  @ApiProperty({ description: 'Ters kayıtlar düşülmüş net tahakkuk.' })
  commissionMinor: number;
  @ApiProperty() bookedMinutes: number;
  @ApiProperty() availableMinutes: number;
  @ApiProperty() occupancyRate: number;
}

export class StaffPerformanceReportDto {
  @ApiProperty({ enum: ['all', 'own'] }) scope: 'all' | 'own';
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: [StaffPerformanceRowDto] }) data: StaffPerformanceRowDto[];
  @ApiProperty() currency: string;
}

export class NoShowTotalsDto {
  @ApiProperty() total: number;
  @ApiProperty() completed: number;
  @ApiProperty() noShow: number;
  @ApiProperty() cancelled: number;
  @ApiProperty({ description: 'Yüzde.' }) noShowRate: number;
  @ApiProperty({ description: 'Yüzde.' }) cancellationRate: number;
}

export class NoShowRowDto extends NoShowTotalsDto {
  @ApiProperty({ nullable: true, type: String }) groupId: string | null;
  @ApiProperty() groupLabel: string;
}

export class NoShowByOriginDto extends NoShowTotalsDto {
  @ApiProperty({ enum: ['internal', 'online'] }) origin: 'internal' | 'online';
}

export class NoShowReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: NoShowTotalsDto }) totals: NoShowTotalsDto;
  @ApiProperty({ type: [NoShowRowDto] }) data: NoShowRowDto[];
  @ApiProperty({
    type: [NoShowByOriginDto],
    description: 'Online randevunun no-show oranı ayrı izlenir (bkz. böl. 11, soru 8).',
  })
  byOrigin: NoShowByOriginDto[];
  @ApiPropertyOptional({ type: NoShowTotalsDto }) previous?: NoShowTotalsDto;
  @ApiPropertyOptional({ type: Object }) delta?: Record<string, number | null>;
}

export class AcquisitionRowDto {
  @ApiProperty({ nullable: true, type: String, description: '`customers.source`' })
  source: string | null;
  @ApiProperty() customers: number;
}

export class RetentionTotalsDto {
  @ApiProperty({ description: 'Penceredeki İLK tamamlanmış randevusu olan müşteriler.' })
  newCustomers: number;
  @ApiProperty({ description: 'Penceredeki randevusu ilk olmayan müşteriler.' })
  returningCustomers: number;
  @ApiProperty() activeCustomers: number;
  @ApiProperty({ description: 'Yüzde — aktiflerin kaçı geri gelen.' })
  returningRate: number;
}

export class CohortReturnDto {
  @ApiProperty({ enum: [30, 60, 90] }) withinDays: number;
  @ApiProperty({ description: 'Kohortun kaçı bu süre içinde geri döndü.' })
  returned: number;
  @ApiProperty({ description: 'Yüzde.' }) rate: number;
}

export class RetentionReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period: ReportPeriodDto;
  @ApiProperty({ type: RetentionTotalsDto }) totals: RetentionTotalsDto;
  @ApiProperty({ type: [AcquisitionRowDto] }) acquisition: AcquisitionRowDto[];
  @ApiProperty({
    type: [CohortReturnDto],
    description:
      'Penceredeki YENİ müşterilerin geri dönüş oranı. Pencere bugüne yakınsa ' +
      'kohortun 90 günü henüz dolmamış olabilir; oran o yüzden düşük görünür.',
  })
  cohorts: CohortReturnDto[];
  @ApiPropertyOptional({ type: RetentionTotalsDto }) previous?: RetentionTotalsDto;
  @ApiPropertyOptional({ type: Object }) delta?: Record<string, number | null>;
}
