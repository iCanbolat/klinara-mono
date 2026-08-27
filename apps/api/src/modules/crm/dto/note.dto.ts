import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { CustomerNoteKind } from '../../../database/schema/crm';

export const CUSTOMER_NOTE_KINDS = ['general', 'treatment', 'internal'] as const;

/** Zaman çizelgesindeki bir olayın türü. Faz 5/6/7 kendi kolunu ekleyecek. */
export const TIMELINE_KINDS = ['appointment', 'note'] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export class CustomerNoteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  appointmentId: string | null;

  @ApiProperty({ enum: CUSTOMER_NOTE_KINDS })
  kind: CustomerNoteKind;

  @ApiProperty()
  body: string;

  @ApiProperty()
  customerVisible: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  authorUserId: string | null;

  @ApiProperty({ description: 'Metin her değiştiğinde trigger artırır.' })
  version: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class CustomerNoteListResponseDto {
  @ApiProperty({ type: [CustomerNoteResponseDto] })
  data: CustomerNoteResponseDto[];
}

export class CreateCustomerNoteDto {
  @ApiProperty({ example: 'Cilt reaksiyonu gözlenmedi.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body: string;

  @ApiPropertyOptional({ enum: CUSTOMER_NOTE_KINDS, default: 'general' })
  @IsOptional()
  @IsIn(CUSTOMER_NOTE_KINDS)
  kind?: CustomerNoteKind;

  @ApiPropertyOptional({ format: 'uuid', description: 'İşlem notunu randevuya bağlar.' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  customerVisible?: boolean;
}

export class UpdateCustomerNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_NOTE_KINDS })
  @IsOptional()
  @IsIn(CUSTOMER_NOTE_KINDS)
  kind?: CustomerNoteKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  customerVisible?: boolean;
}

export class CustomerNoteRevisionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Düzenlemeden ÖNCEKİ metin.' })
  body: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  editedBy: string | null;

  @ApiProperty({ format: 'date-time' })
  editedAt: string;
}

export class CustomerNoteRevisionListDto {
  @ApiProperty({ type: [CustomerNoteRevisionDto] })
  data: CustomerNoteRevisionDto[];
}

export class TimelineEntryDto {
  @ApiProperty({ enum: TIMELINE_KINDS })
  kind: TimelineKind;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time', description: 'Olayın gerçekleştiği an (UTC).' })
  occurredAt: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Türe göre değişen yük: randevu özeti veya not gövdesi.',
  })
  payload: Record<string, unknown>;
}

export class TimelinePageDto {
  @ApiProperty({ type: [TimelineEntryDto] })
  data: TimelineEntryDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export class TimelineQueryDto {
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
