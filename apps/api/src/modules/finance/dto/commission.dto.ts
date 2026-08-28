import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  CommissionBasis,
  CommissionCalcKind,
  CommissionPeriodStatus,
  CommissionScope,
  CommissionTrigger,
} from '../../../database/schema';

export const COMMISSION_SCOPES = ['global', 'service', 'package', 'product'] as const;
export const COMMISSION_CALC_KINDS = ['percent', 'fixed'] as const;
export const COMMISSION_BASES = [
  'service_price',
  'net_after_discount',
  'collected_amount',
] as const;
export const COMMISSION_TRIGGERS = ['service_completed', 'payment_received'] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCommissionRuleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: COMMISSION_SCOPES, default: 'global' })
  @IsOptional()
  @IsIn(COMMISSION_SCOPES)
  scope?: CommissionScope;

  @ApiPropertyOptional({ format: 'uuid', description: 'Kapsam `global` değilse zorunlu.' })
  @IsOptional()
  @IsUUID()
  scopeRefId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Verilmezse tüm personele uygulanır.' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;

  @ApiProperty({ enum: COMMISSION_CALC_KINDS })
  @IsIn(COMMISSION_CALC_KINDS)
  calcKind: CommissionCalcKind;

  @ApiProperty({
    description: '`percent` için BAZ PUAN (1000 = %10), `fixed` için minor unit.',
    example: 1000,
  })
  @IsInt()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ enum: COMMISSION_BASES, default: 'net_after_discount' })
  @IsOptional()
  @IsIn(COMMISSION_BASES)
  basis?: CommissionBasis;

  @ApiPropertyOptional({ enum: COMMISSION_TRIGGERS, default: 'service_completed' })
  @IsOptional()
  @IsIn(COMMISSION_TRIGGERS)
  triggerOn?: CommissionTrigger;

  @ApiPropertyOptional({ default: 0, description: 'Yüksek öncelik önce uygulanır.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(ISO_DATE)
  effectiveFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(ISO_DATE)
  effectiveTo?: string;
}

export class UpdateCommissionRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(ISO_DATE)
  effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCommissionRulesQueryDto {
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

export class CommissionRuleResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: COMMISSION_SCOPES }) scope: CommissionScope;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) scopeRefId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) staffProfileId: string | null;
  @ApiProperty({ enum: COMMISSION_CALC_KINDS }) calcKind: CommissionCalcKind;
  @ApiProperty() value: number;
  @ApiProperty({ enum: COMMISSION_BASES }) basis: CommissionBasis;
  @ApiProperty({ enum: COMMISSION_TRIGGERS }) triggerOn: CommissionTrigger;
  @ApiProperty() priority: number;
  @ApiPropertyOptional({ nullable: true }) effectiveFrom: string | null;
  @ApiPropertyOptional({ nullable: true }) effectiveTo: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() version: number;
}

export class CommissionRulePageDto {
  @ApiProperty({ type: [CommissionRuleResponseDto] }) data: CommissionRuleResponseDto[];
  @ApiProperty() pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class ListAccrualsQueryDto {
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

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class CommissionAccrualResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) staffProfileId: string;
  @ApiProperty({ format: 'uuid' }) periodId: string;
  @ApiProperty({ enum: COMMISSION_TRIGGERS }) triggerOn: CommissionTrigger;
  @ApiProperty({ enum: COMMISSION_BASES }) ruleBasis: CommissionBasis;
  @ApiProperty({ description: 'Primin hesaplandığı matrah; ters kayıtta negatif.' })
  basisMinor: number;
  @ApiProperty({ description: 'Prim tutarı; ters kayıtta negatif.' }) amountMinor: number;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) chargeId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) paymentId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  reversesAccrualId: string | null;
  @ApiPropertyOptional({ nullable: true }) reason: string | null;
  @ApiProperty() createdAt: string;
}

export class CommissionAccrualPageDto {
  @ApiProperty({ type: [CommissionAccrualResponseDto] })
  data: CommissionAccrualResponseDto[];
  @ApiProperty() pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class CommissionPeriodResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) branchId: string;
  @ApiProperty() startsOn: string;
  @ApiProperty() endsOn: string;
  @ApiProperty({ enum: ['open', 'closed'] }) status: CommissionPeriodStatus;
  @ApiPropertyOptional({ nullable: true }) closedAt: string | null;
  @ApiProperty() version: number;
}

export class CommissionReportRowDto {
  @ApiProperty({ format: 'uuid' }) staffProfileId: string;
  @ApiProperty() staffName: string;
  @ApiProperty({ description: 'Ters kayıtlar DÜŞÜLMÜŞ net prim.' }) amountMinor: number;
  @ApiProperty() accrualCount: number;
}

export class CommissionReportDto {
  @ApiProperty({ type: [CommissionReportRowDto] }) rows: CommissionReportRowDto[];
  @ApiProperty() totalMinor: number;
  @ApiProperty() currency: string;
}

export class ListPeriodsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: CommissionPeriodStatus;
}

export class CommissionReportQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;
}
