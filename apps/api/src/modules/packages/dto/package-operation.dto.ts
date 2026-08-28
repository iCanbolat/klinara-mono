import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AdjustItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerPackageItemId: string;

  @ApiProperty({
    description: 'Pozitif = hak ekle, negatif = hak düş. Sıfır olamaz.',
    example: -1,
  })
  @IsInt()
  delta: number;
}

export class AdjustPackageDto {
  @ApiProperty({ type: [AdjustItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AdjustItemDto)
  items: AdjustItemDto[];

  @ApiProperty({
    minLength: 5,
    description: 'ZORUNLU. Manuel düzeltme gerekçesiz yapılamaz — DB de zorlar.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class RefundItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerPackageItemId: string;

  @ApiProperty({ minimum: 1, description: 'İade edilecek seans sayısı' })
  @IsInt()
  @Min(1)
  sessions: number;
}

export class RefundPackageDto {
  @ApiPropertyOptional({
    type: [RefundItemDto],
    description: 'Verilmezse TÜM kalan hak iade edilir (tam iade).',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RefundItemDto)
  items?: RefundItemDto[];

  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class TransferItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerPackageItemId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  sessions: number;
}

export class TransferPackageDto {
  @ApiProperty({ format: 'uuid', description: 'Hakkın devredileceği müşteri' })
  @IsUUID()
  targetCustomerId: string;

  @ApiPropertyOptional({
    type: [TransferItemDto],
    description: 'Verilmezse tüm kalan hak devredilir.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items?: TransferItemDto[];

  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ConsumePackageLineDto {
  @ApiProperty({ format: 'uuid', description: 'Randevunun hizmet kalemi' })
  @IsUUID()
  appointmentServiceId: string;

  @ApiProperty({ format: 'uuid', description: 'Düşülecek müşteri paketi kalemi' })
  @IsUUID()
  customerPackageItemId: string;
}

export class ConsumePackageDto {
  @ApiProperty({ type: [ConsumePackageLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ConsumePackageLineDto)
  lines: ConsumePackageLineDto[];
}

export class ConsumePackageResultDto {
  @ApiProperty({ description: 'Bağlanan randevu kalemi sayısı' })
  bound: number;

  @ApiProperty({
    description: 'Düşülen seans sayısı. Randevu henüz `completed` değilse 0.',
  })
  consumed: number;
}

export class RefundResultDto {
  @ApiProperty()
  refundedSessions: number;

  @ApiProperty({ description: 'Satış anındaki tahsisten hesaplanır (kuruş)' })
  refundAmountMinor: number;

  @ApiProperty({
    enum: ['pending', 'settled'],
    description: 'pending = borç doğdu; kasa hareketi Batch 6.2de bağlanacak',
  })
  settlementStatus: string;
}

export class ListEntitlementsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Yalnız bu hizmetin hakları' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Yalnız bu şubede satılmış paketler' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class PackageEntitlementDto {
  @ApiProperty({ format: 'uuid' })
  customerPackageItemId: string;

  @ApiProperty({ format: 'uuid' })
  customerPackageId: string;

  @ApiProperty()
  packageName: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty()
  serviceName: string;

  @ApiProperty()
  remainingSessions: number;

  @ApiProperty({ nullable: true, type: String })
  expiresAt: string | null;

  @ApiProperty({ format: 'uuid' })
  branchId: string;
}
