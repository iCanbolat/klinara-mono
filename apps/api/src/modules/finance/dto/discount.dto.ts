import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { DiscountKind, DiscountScope } from '../../../database/schema';

export const DISCOUNT_KINDS = ['percent', 'amount'] as const;
export const DISCOUNT_SCOPES = ['all', 'service', 'package'] as const;

export class CreateDiscountDto {
  @ApiPropertyOptional({
    description: 'Kampanya kodu. Verilmezse indirim yalnız elle seçilebilir.',
    example: 'YAZ2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ enum: DISCOUNT_KINDS })
  @IsIn(DISCOUNT_KINDS)
  kind: DiscountKind;

  @ApiProperty({
    description: "`percent` için BAZ PUAN (1500 = %15), `amount` için minor unit (kuruş).",
    example: 1500,
  })
  @IsInt()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ enum: DISCOUNT_SCOPES, default: 'all' })
  @IsOptional()
  @IsIn(DISCOUNT_SCOPES)
  scope?: DiscountScope;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "`scope='service'` ise hizmet, `scope='package'` ise paket tanımı kimliği.",
  })
  @IsOptional()
  @IsUUID()
  scopeRefId?: string;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @ApiPropertyOptional({ description: 'Verilmezse sınırsız.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;
}

export class UpdateDiscountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListDiscountsQueryDto {
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

  @ApiPropertyOptional({ description: 'Yalnız kullanılabilir durumdakiler.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean;
}

export class DiscountResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiPropertyOptional({ nullable: true }) code: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ enum: DISCOUNT_KINDS }) kind: DiscountKind;
  @ApiProperty() value: number;
  @ApiProperty({ enum: DISCOUNT_SCOPES }) scope: DiscountScope;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) scopeRefId: string | null;
  @ApiPropertyOptional({ nullable: true }) startsAt: string | null;
  @ApiPropertyOptional({ nullable: true }) endsAt: string | null;
  @ApiPropertyOptional({ nullable: true }) maxRedemptions: number | null;
  @ApiProperty() redeemedCount: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() version: number;
  @ApiProperty() createdAt: string;
}

export class DiscountPageDto {
  @ApiProperty({ type: [DiscountResponseDto] }) data: DiscountResponseDto[];
  @ApiProperty() pageInfo: { nextCursor: string | null; hasMore: boolean };
}
