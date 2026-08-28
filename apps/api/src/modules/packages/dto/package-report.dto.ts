import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const OUTSTANDING_GROUPINGS = ['service', 'customer', 'branch'] as const;
export const USAGE_GROUPINGS = ['service', 'branch'] as const;

export class OutstandingReportQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({ enum: OUTSTANDING_GROUPINGS, default: 'service' })
  @IsOptional()
  @IsIn(OUTSTANDING_GROUPINGS)
  groupBy?: (typeof OUTSTANDING_GROUPINGS)[number];
}

export class ExpiringReportQueryDto {
  @ApiProperty({ example: '2026-09-01T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-10-01T00:00:00+03:00', description: 'HARİÇ (yarı açık aralık)' })
  @IsISO8601({ strict: true })
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class UsageReportQueryDto {
  @ApiProperty({ example: '2026-09-01T00:00:00+03:00' })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-10-01T00:00:00+03:00', description: 'HARİÇ (yarı açık aralık)' })
  @IsISO8601({ strict: true })
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: USAGE_GROUPINGS, default: 'service' })
  @IsOptional()
  @IsIn(USAGE_GROUPINGS)
  groupBy?: (typeof USAGE_GROUPINGS)[number];
}

export class OutstandingRowDto {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  groupId: string | null;

  @ApiProperty({ description: 'Hizmet / müşteri / şube adı' })
  groupLabel: string;

  @ApiProperty()
  packages: number;

  @ApiProperty()
  remainingSessions: number;

  @ApiProperty({ description: 'Satış anındaki tahsisten hesaplanan yükümlülük (kuruş)' })
  outstandingMinor: number;
}

export class OutstandingTotalsDto {
  @ApiProperty()
  packages: number;

  @ApiProperty()
  remainingSessions: number;

  @ApiProperty()
  outstandingMinor: number;

  @ApiProperty({ example: 'TRY' })
  currency: string;
}

export class OutstandingReportDto {
  @ApiProperty({ type: OutstandingTotalsDto })
  totals: OutstandingTotalsDto;

  @ApiProperty({ type: [OutstandingRowDto] })
  data: OutstandingRowDto[];
}

export class ExpiringRowDto {
  @ApiProperty({ format: 'uuid' })
  customerPackageId: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty()
  customerName: string;

  @ApiProperty()
  packageName: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty()
  remainingSessions: number;

  @ApiProperty()
  expiresAt: string;

  @ApiPropertyOptional({
    description: 'Yalnız `report.revenue:read` izniyle döner.',
    nullable: true,
    type: Number,
  })
  outstandingMinor?: number | null;
}

export class ExpiringReportDto {
  @ApiProperty({ type: [ExpiringRowDto] })
  data: ExpiringRowDto[];

  @ApiProperty()
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class UsageRowDto {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  groupId: string | null;

  @ApiProperty()
  groupLabel: string;

  @ApiProperty({ description: 'Dönemde satılan seans' })
  purchased: number;

  @ApiProperty({ description: 'Dönemde tüketilen seans (ters kayıtlar düşülmüş)' })
  consumed: number;

  @ApiProperty()
  refunded: number;

  @ApiProperty()
  expired: number;

  @ApiProperty()
  transferred: number;

  @ApiProperty()
  adjusted: number;
}

export class UsageReportDto {
  @ApiProperty({ type: [UsageRowDto] })
  data: UsageRowDto[];
}
