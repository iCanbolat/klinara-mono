import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { ChargeSource, ChargeStatus, DiscountKind } from '../../../database/schema';

export const CHARGE_SOURCES = [
  'appointment_service',
  'package_sale',
  'package_refund',
  'product',
  'manual',
] as const;

/** Elle açılabilen kaynaklar. Randevu/paket kalemleri OTOMATİK doğar. */
export const MANUAL_CHARGE_SOURCES = ['product', 'manual'] as const;

export class CreateChargeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({
    enum: MANUAL_CHARGE_SOURCES,
    description:
      'Yalnız `product` ve `manual` elle açılabilir. Randevu ve paket kalemleri ' +
      'kendi işlemlerinin transaction’ında otomatik doğar.',
  })
  @IsIn(MANUAL_CHARGE_SOURCES)
  source: 'product' | 'manual';

  @ApiProperty({ example: 'Bakım şampuanı 250 ml' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  @ApiProperty({ description: 'KDV DAHİL birim fiyat (kuruş).', example: 45000 })
  @IsInt()
  @Min(0)
  unitPriceMinor: number;

  @ApiPropertyOptional({
    description: 'Karşılaştırma için liste fiyatı. Verilmezse `unitPriceMinor` alınır.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitListPriceMinor?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  discountId?: string;

  @ApiPropertyOptional({ default: 2000, description: 'Baz puan; 2000 = %20.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  vatRateBasisPoints?: number;

  @ApiPropertyOptional({
    description: 'Liste fiyatının dışına çıkılıyorsa ZORUNLU (`finance.price:override`).',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  priceOverrideReason?: string;
}

export class UpdateChargeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  @ApiPropertyOptional({ description: 'KDV DAHİL birim fiyat (kuruş).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceMinor?: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  discountId?: string | null;

  @ApiPropertyOptional({
    description: 'Liste fiyatının dışına çıkılıyorsa ZORUNLU (`finance.price:override`).',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  priceOverrideReason?: string;
}

export class VoidChargeDto {
  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ListChargesQueryDto {
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
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: CHARGE_SOURCES })
  @IsOptional()
  @IsIn(CHARGE_SOURCES)
  source?: ChargeSource;

  @ApiPropertyOptional({ enum: ['open', 'void'] })
  @IsOptional()
  @IsIn(['open', 'void'])
  status?: ChargeStatus;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class ChargeResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) branchId: string;
  @ApiProperty({ format: 'uuid' }) customerId: string;
  @ApiProperty({ enum: CHARGE_SOURCES }) source: ChargeSource;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  appointmentServiceId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  customerPackageId: string | null;
  @ApiProperty() description: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unitListPriceMinor: number;
  @ApiProperty() unitPriceMinor: number;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) discountId: string | null;
  @ApiPropertyOptional({ nullable: true }) discountKind: DiscountKind | null;
  @ApiPropertyOptional({ nullable: true }) discountValue: number | null;
  @ApiProperty() discountMinor: number;
  @ApiProperty() vatRateBasisPoints: number;
  @ApiProperty({ description: 'KDV DAHİL brüt tutar.' }) totalMinor: number;
  @ApiProperty() netMinor: number;
  @ApiProperty() vatMinor: number;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: ['open', 'void'] }) status: ChargeStatus;
  @ApiPropertyOptional({ nullable: true }) priceOverrideReason: string | null;
  @ApiPropertyOptional({ nullable: true }) voidedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) voidedReason: string | null;
  @ApiProperty() version: number;
  @ApiProperty() createdAt: string;
}

export class ChargePageDto {
  @ApiProperty({ type: [ChargeResponseDto] }) data: ChargeResponseDto[];
  @ApiProperty() pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class AccountEntryDto {
  @ApiProperty({ format: 'uuid' }) entryId: string;
  @ApiProperty({ enum: ['charge', 'payment'] }) entryKind: 'charge' | 'payment';
  @ApiProperty({ description: 'Kalem kaynağı ya da tahsilat yöntemi.' })
  entrySource: string;
  @ApiProperty() description: string;
  @ApiProperty({ description: 'Borç pozitif, alacak negatif.' }) amountMinor: number;
  @ApiProperty() currency: string;
  @ApiProperty() occurredAt: string;
}

export class CustomerAccountDto {
  @ApiProperty({ format: 'uuid' }) customerId: string;
  @ApiProperty({ description: 'Toplam borç (açık ücret kalemleri).' })
  chargedMinor: number;
  @ApiProperty({ description: 'Toplam tahsilat.' }) paidMinor: number;
  @ApiProperty({ description: '`chargedMinor - paidMinor`. Pozitif = müşteri borçlu.' })
  balanceMinor: number;
  @ApiProperty() currency: string;
  @ApiProperty({ type: [AccountEntryDto] }) entries: AccountEntryDto[];
  @ApiProperty() pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class ListAccountQueryDto {
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
