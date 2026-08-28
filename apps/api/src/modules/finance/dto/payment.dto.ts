import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import type { PaymentMethod, PaymentStatus } from '../../../database/schema';

export const PAYMENT_METHODS = [
  'cash',
  'card',
  'bank_transfer',
  'gift_voucher',
  'other',
] as const;

export class PaymentAllocationInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  chargeId: string;

  @ApiProperty({ description: 'Bu kaleme tahsis edilen tutar (kuruş).' })
  @IsInt()
  @Min(1)
  amountMinor: number;
}

export class CreatePaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  @ApiProperty({ description: 'Tahsil edilen toplam tutar (kuruş).', example: 150_000 })
  @IsInt()
  @Min(1)
  amountMinor: number;

  @ApiPropertyOptional({
    type: [PaymentAllocationInputDto],
    description:
      'Tahsilatın ücret kalemlerine dağıtımı. Verilmezse müşterinin açık ' +
      'kalemlerine ESKİDEN YENİYE otomatik dağıtılır.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationInputDto)
  allocations?: PaymentAllocationInputDto[];

  @ApiPropertyOptional({ example: '2026-09-01T10:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  paidAt?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Nakit tahsilatta zorunlu (6.3).' })
  @IsOptional()
  @IsUUID()
  cashSessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class VoidPaymentDto {
  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ListPaymentsQueryDto {
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

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: ['posted', 'void'] })
  @IsOptional()
  @IsIn(['posted', 'void'])
  status?: PaymentStatus;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00+03:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class PaymentAllocationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) chargeId: string;
  @ApiProperty() amountMinor: number;
  @ApiProperty() chargeDescription: string;
}

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) branchId: string;
  @ApiProperty({ format: 'uuid' }) customerId: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) method: PaymentMethod;
  @ApiProperty() amountMinor: number;
  @ApiProperty({ description: 'Kalemlere dağıtılmış tutar.' }) allocatedMinor: number;
  @ApiProperty({ description: '`amountMinor - allocatedMinor`; avans olarak durur.' })
  unallocatedMinor: number;
  @ApiProperty() currency: string;
  @ApiProperty({ description: 'Kiracı bazlı, BOŞLUKSUZ artan makbuz numarası.' })
  receiptNo: number;
  @ApiProperty() paidAt: string;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) cashSessionId: string | null;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiProperty({ enum: ['posted', 'void'] }) status: PaymentStatus;
  @ApiPropertyOptional({ nullable: true }) voidedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) voidedReason: string | null;
  @ApiProperty({ type: [PaymentAllocationDto] }) allocations: PaymentAllocationDto[];
  @ApiProperty() version: number;
  @ApiProperty() createdAt: string;
}

export class PaymentPageDto {
  @ApiProperty({ type: [PaymentResponseDto] }) data: PaymentResponseDto[];
  @ApiProperty() pageInfo: { nextCursor: string | null; hasMore: boolean };
}
