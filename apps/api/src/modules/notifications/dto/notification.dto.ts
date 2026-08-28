import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  MessageStatus,
  NotificationChannel,
  NotificationEvent,
  NotificationKind,
  OptOutSource,
} from '../../../database/schema';
import { ALL_CHANNELS, ALL_EVENTS } from '../default-templates';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'];

// ---------------------------------------------------------------------------
// Şablonlar
// ---------------------------------------------------------------------------

export class NotificationTemplateResponseDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Kiracı satırı yoksa null — varsayılan şablon' })
  id: string | null;

  @ApiProperty({ enum: ALL_EVENTS })
  event: NotificationEvent;

  @ApiProperty({ enum: ALL_CHANNELS })
  channel: NotificationChannel;

  @ApiProperty({ example: 'tr' })
  locale: string;

  @ApiProperty({ enum: ['transactional', 'marketing'] })
  kind: NotificationKind;

  @ApiPropertyOptional({ nullable: true })
  subject: string | null;

  @ApiProperty()
  body: string;

  @ApiPropertyOptional({ nullable: true, description: "Meta'da onaylı template adı (8.2)" })
  whatsappTemplateName: string | null;

  @ApiPropertyOptional({ nullable: true })
  whatsappTemplateLanguage: string | null;

  @ApiProperty({
    type: [String],
    description: "Meta template'inin {{1}}, {{2}}… sırasına karşılık gelen değişken adları",
  })
  whatsappVariables: string[];

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'Kiracı kendi metnini yazmadıysa varsayılan geçerlidir' })
  isDefault: boolean;

  @ApiProperty({ type: [String], description: 'Metnin beklediği değişkenler' })
  variables: string[];
}

export class UpsertNotificationTemplateDto {
  @ApiProperty({ enum: ALL_EVENTS })
  @IsIn(ALL_EVENTS)
  event: NotificationEvent;

  @ApiProperty({ enum: ALL_CHANNELS })
  @IsIn(ALL_CHANNELS)
  channel: NotificationChannel;

  @ApiPropertyOptional({ default: 'tr' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Yalnız e-posta kanalında' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiProperty({ example: 'Sayın {{customerName}}, {{appointmentAt}} randevunuzu hatırlatırız.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  whatsappTemplateName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsappTemplateLanguage?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "Meta template'inin konumsal değişkenleri, SIRAYLA (`{{1}}` → ilk eleman)",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  whatsappVariables?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Tercihler
// ---------------------------------------------------------------------------

export class NotificationPreferenceResponseDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  id: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'null = kiracı varsayılanı' })
  branchId: string | null;

  @ApiProperty({ enum: ALL_EVENTS })
  event: NotificationEvent;

  @ApiProperty({ enum: ['transactional', 'marketing'] })
  kind: NotificationKind;

  @ApiProperty({ type: [String], description: 'Denenecek kanallar, öncelik sırasında' })
  channels: NotificationChannel[];

  @ApiPropertyOptional({ nullable: true, example: '21:00' })
  quietHoursStart: string | null;

  @ApiPropertyOptional({ nullable: true, example: '09:00' })
  quietHoursEnd: string | null;

  @ApiProperty({ description: 'Kiracı satırı yoksa kod içindeki varsayılan geçerlidir' })
  isDefault: boolean;
}

export class UpsertNotificationPreferenceDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Verilmezse kiracı varsayılanı yazılır' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ enum: ALL_EVENTS })
  @IsIn(ALL_EVENTS)
  event: NotificationEvent;

  @ApiProperty({ type: [String], enum: ALL_CHANNELS, description: 'Boş dizi = olay kapalı' })
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(ALL_CHANNELS, { each: true })
  channels: NotificationChannel[];

  @ApiPropertyOptional({ example: '21:00', nullable: true })
  @IsOptional()
  @Matches(CLOCK, { message: "'HH:MM' biçiminde olmalı" })
  quietHoursStart?: string;

  @ApiPropertyOptional({ example: '09:00', nullable: true })
  @IsOptional()
  @Matches(CLOCK, { message: "'HH:MM' biçiminde olmalı" })
  quietHoursEnd?: string;
}

// ---------------------------------------------------------------------------
// Mesaj kaydı
// ---------------------------------------------------------------------------

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  customerId: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  userId: string | null;

  @ApiProperty({ enum: ALL_CHANNELS })
  channel: NotificationChannel;

  @ApiProperty({ enum: ALL_EVENTS })
  event: NotificationEvent;

  @ApiProperty({ enum: MESSAGE_STATUSES })
  status: MessageStatus;

  @ApiProperty({ example: '+90**********67', description: 'Ham adres saklanmaz' })
  to: string;

  @ApiPropertyOptional({ nullable: true })
  subject: string | null;

  @ApiPropertyOptional({ nullable: true })
  body: string | null;

  @ApiPropertyOptional({ nullable: true })
  errorCode: string | null;

  @ApiProperty()
  attempt: number;

  @ApiProperty({ format: 'date-time' })
  scheduledFor: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  sentAt: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  deliveredAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ListMessagesQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: ALL_CHANNELS })
  @IsOptional()
  @IsIn(ALL_CHANNELS)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ enum: ALL_EVENTS })
  @IsOptional()
  @IsIn(ALL_EVENTS)
  event?: NotificationEvent;

  @ApiPropertyOptional({ enum: MESSAGE_STATUSES })
  @IsOptional()
  @IsIn(MESSAGE_STATUSES)
  status?: MessageStatus;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
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

export class MessagePageDto {
  @ApiProperty({ type: [MessageResponseDto] })
  data: MessageResponseDto[];

  @ApiProperty()
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

// ---------------------------------------------------------------------------
// Opt-out
// ---------------------------------------------------------------------------

export class CreateOptOutDto {
  @ApiPropertyOptional({ enum: ALL_CHANNELS, description: 'Verilmezse TÜM kanallar' })
  @IsOptional()
  @IsIn(ALL_CHANNELS)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ enum: ['customer_request', 'inbound_stop', 'staff'] })
  @IsOptional()
  @IsIn(['customer_request', 'inbound_stop', 'staff'])
  source?: OptOutSource;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class OptOutResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiPropertyOptional({ nullable: true, enum: ALL_CHANNELS })
  channel: NotificationChannel | null;

  @ApiProperty({ enum: ['transactional', 'marketing'] })
  kind: NotificationKind;

  @ApiProperty({ enum: ['customer_request', 'inbound_stop', 'staff'] })
  source: OptOutSource;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}
