import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { CashMovementKind, PaymentMethod, RefundKind } from '../../../database/schema';
import { PAYMENT_METHODS } from './payment.dto';

export const REFUND_KINDS = ['package', 'service', 'other'] as const;

export class OpenCashSessionDto {
  @ApiPropertyOptional({ default: 0, description: 'Çekmecedeki açılış nakdi (kuruş).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  openingBalanceMinor?: number;
}

export class CloseCashSessionDto {
  @ApiProperty({ description: 'Sayılan nakit (kuruş).' })
  @IsInt()
  @Min(0)
  countedMinor: number;

  @ApiPropertyOptional({ description: 'Sayım ile beklenen arasında fark varsa ZORUNLU.' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  differenceReason?: string;
}

export class CreateRefundDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ enum: REFUND_KINDS })
  @IsIn(REFUND_KINDS)
  kind: RefundKind;

  @ApiProperty({ description: 'İade edilen tutar (kuruş, POZİTİF).' })
  @IsInt()
  @Min(1)
  amountMinor: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Kapatılacak NEGATİF ücret kalemi. Paket iadesinde 5.3 akışının ürettiği kalem.',
  })
  @IsOptional()
  @IsUUID()
  chargeId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Paket iadesinde zorunlu.' })
  @IsOptional()
  @IsUUID()
  customerPackageId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Nakit iadede zorunlu.' })
  @IsOptional()
  @IsUUID()
  cashSessionId?: string;

  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ListCashSessionsQueryDto {
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
  branchId?: string;

  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

export class CashSessionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) branchId: string;
  @ApiProperty({ enum: ['open', 'closed'] }) status: 'open' | 'closed';
  @ApiProperty() openingBalanceMinor: number;
  @ApiProperty() openedAt: string;
  @ApiPropertyOptional({ nullable: true }) closedAt: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Kapanışta hesaplanır.' })
  expectedMinor: number | null;
  @ApiPropertyOptional({ nullable: true }) countedMinor: number | null;
  @ApiPropertyOptional({ nullable: true }) differenceMinor: number | null;
  @ApiPropertyOptional({ nullable: true }) differenceReason: string | null;
  @ApiProperty() currency: string;
  @ApiProperty() version: number;
}

export class CashMovementDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['opening', 'payment', 'refund', 'payout', 'deposit'] })
  kind: CashMovementKind;
  @ApiProperty({ description: 'Giriş pozitif, çıkış negatif.' }) amountMinor: number;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) paymentId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) refundId: string | null;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiProperty() createdAt: string;
}

export class CashSessionSummaryDto {
  @ApiProperty({ type: CashSessionResponseDto }) session: CashSessionResponseDto;
  @ApiProperty({ description: 'Açılış + nakit hareketler; kapanışta beklenen tutar.' })
  expectedMinor: number;
  @ApiProperty({ description: 'Oturumdaki tüm tahsilatların yöntem kırılımı.' })
  byMethod: { method: PaymentMethod; amountMinor: number; count: number }[];
  @ApiProperty({ type: [CashMovementDto] }) movements: CashMovementDto[];
}

export class CashSessionPageDto {
  @ApiProperty({ type: [CashSessionResponseDto] }) data: CashSessionResponseDto[];
  @ApiProperty() pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class RefundResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) customerId: string;
  @ApiProperty({ enum: REFUND_KINDS }) kind: RefundKind;
  @ApiProperty() amountMinor: number;
  @ApiProperty({ enum: PAYMENT_METHODS }) method: PaymentMethod;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) chargeId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  customerPackageId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) cashSessionId: string | null;
  @ApiProperty() reason: string;
  @ApiProperty() refundedAt: string;
  @ApiProperty({ description: 'Paket iadesinde `settled`e çekilen mutabakat durumu.' })
  packageSettlementStatus: string | null;
}
