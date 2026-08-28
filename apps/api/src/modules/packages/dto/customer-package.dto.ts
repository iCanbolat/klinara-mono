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
} from 'class-validator';
import type { CustomerPackageStatus, LedgerEntryType } from '../../../database/schema';

export const CUSTOMER_PACKAGE_STATUSES = [
  'active',
  'expired',
  'refunded',
  'transferred',
] as const;

export class CreateCustomerPackageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  definitionId: string;

  @ApiPropertyOptional({
    description: 'Verilmezse satış anı. Geçmişe dönük kayıt için kullanılır.',
    example: '2026-09-01T10:00:00+03:00',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  soldAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ListCustomerPackagesQueryDto {
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

  @ApiPropertyOptional({ enum: CUSTOMER_PACKAGE_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_PACKAGE_STATUSES)
  status?: CustomerPackageStatus;
}

export class ListLedgerQueryDto {
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

export class CustomerPackageItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty({ description: 'Satış anındaki hizmet adı (snapshot)' })
  serviceName: string;

  @ApiProperty({ description: 'Satılan seans sayısı' })
  quantityTotal: number;

  @ApiProperty({ description: 'Kalan hak — DEFTERDEN türetilir' })
  remainingSessions: number;

  @ApiProperty({ description: 'Satış anındaki katalog birim fiyatı (gösterim)' })
  unitListPriceMinor: number;

  @ApiProperty({ description: 'Satış tutarının bu kaleme tahsis edilen payı' })
  itemTotalMinor: number;

  @ApiProperty({ description: 'Kalan hakkın parasal karşılığı (yükümlülük)' })
  outstandingMinor: number;

  @ApiProperty()
  sortOrder: number;
}

export class CustomerPackageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  definitionId: string | null;

  @ApiProperty({ description: 'Satış anındaki paket adı (snapshot)' })
  name: string;

  @ApiProperty({ description: 'Satın alınan tanım revizyonu' })
  definitionRevision: number;

  @ApiProperty()
  totalPriceMinor: number;

  @ApiProperty({ example: 'TRY' })
  currency: string;

  @ApiProperty()
  isTransferable: boolean;

  @ApiProperty({ nullable: true, type: Number })
  validityDays: number | null;

  @ApiProperty()
  soldAt: string;

  @ApiProperty({ nullable: true, type: String })
  expiresAt: string | null;

  @ApiProperty({ enum: CUSTOMER_PACKAGE_STATUSES })
  status: CustomerPackageStatus;

  @ApiProperty({ description: 'Kalemlerin toplamı' })
  remainingSessions: number;

  @ApiProperty({ description: 'Tüm kalemlerin kalan hak karşılığı' })
  outstandingMinor: number;

  @ApiProperty()
  refundedSessions: number;

  @ApiProperty()
  refundAmountMinor: number;

  @ApiProperty({
    nullable: true,
    enum: ['pending', 'settled'],
    description: 'pending = borç doğdu, kasa hareketi Faz 6.2de bağlanacak',
  })
  refundSettlementStatus: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundedAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundReason: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  transferredFromPackageId: string | null;

  @ApiProperty({ nullable: true, type: String })
  note: string | null;

  @ApiProperty({ description: 'Optimistic locking sayacı (ETag)' })
  version: number;

  @ApiProperty({ type: [CustomerPackageItemResponseDto] })
  items: CustomerPackageItemResponseDto[];

  @ApiProperty()
  createdAt: string;
}

export class PackageLedgerEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  customerPackageItemId: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty()
  serviceName: string;

  @ApiProperty({
    enum: [
      'purchase',
      'consume',
      'refund',
      'transfer_in',
      'transfer_out',
      'expire',
      'manual_adjustment',
    ],
  })
  entryType: LedgerEntryType;

  @ApiProperty({ description: 'purchase +10, consume -1' })
  delta: number;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  appointmentId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  actorUserId: string | null;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Dolu ise bu satır bir düzeltmedir; işaret ettiği kaydı geri alır.',
  })
  reversesEntryId: string | null;

  @ApiProperty()
  createdAt: string;
}

export class CustomerPackagePageDto {
  @ApiProperty({ type: [CustomerPackageResponseDto] })
  data: CustomerPackageResponseDto[];

  @ApiProperty()
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class PackageLedgerPageDto {
  @ApiProperty({ type: [PackageLedgerEntryResponseDto] })
  data: PackageLedgerEntryResponseDto[];

  @ApiProperty()
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}
