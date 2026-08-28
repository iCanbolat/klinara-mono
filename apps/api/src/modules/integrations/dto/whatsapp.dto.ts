import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class WhatsAppAccountResponseDto {
  @ApiProperty({ example: '102290129340398' })
  wabaId: string;

  @ApiProperty({ example: '106540352242922' })
  phoneNumberId: string;

  @ApiPropertyOptional({ nullable: true, example: '+905321234567' })
  businessPhone: string | null;

  @ApiProperty({ example: 'v21.0' })
  apiVersion: string;

  @ApiProperty({ enum: ['unconfigured', 'active', 'error'] })
  status: string;

  /** Token ASLA dönmez; yalnız kurulu olduğunu ve son 4 hanesini gösteririz. */
  @ApiProperty({ example: '••••••••a91f', description: 'Token maskeli; ham değer hiçbir yanıtta dönmez' })
  accessTokenMasked: string;

  @ApiProperty({ description: 'Webhook imzası için app secret kurulu mu (8.3)' })
  hasAppSecret: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastVerifiedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastError: string | null;
}

export class UpsertWhatsAppAccountDto {
  @ApiProperty({ description: "Meta Business hesabının WABA kimliği" })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  wabaId: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  phoneNumberId: string;

  @ApiPropertyOptional({ example: '+905321234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  businessPhone?: string;

  @ApiProperty({ description: 'Kalıcı erişim token’ı — şifreli saklanır, bir daha okunamaz' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  accessToken: string;

  @ApiPropertyOptional({ description: 'Webhook imza doğrulaması için (8.3)' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  appSecret?: string;

  @ApiPropertyOptional({ example: 'v21.0' })
  @IsOptional()
  @Matches(/^v\d+\.\d+$/, { message: "'v21.0' biçiminde olmalı" })
  apiVersion?: string;
}

export class WhatsAppTestSendDto {
  @ApiProperty({ example: '+905321234567' })
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  to: string;

  @ApiProperty({ description: "Meta'da ONAYLI template adı" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  templateName: string;

  @ApiPropertyOptional({ example: 'tr' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  templateLanguage?: string;
}

export class WhatsAppTemplateResponseDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  language: string;

  @ApiPropertyOptional({ nullable: true })
  category: string | null;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected'] })
  status: string;

  @ApiProperty()
  bodyVariableCount: number;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  buttons: { type: string; text: string }[];

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  syncedAt: string | null;
}

export class WhatsAppVerifyResultDto {
  @ApiProperty()
  ok: boolean;

  @ApiPropertyOptional({ nullable: true })
  error: string | null;

  @ApiProperty({ description: "Meta'dan çekilen template sayısı" })
  templateCount: number;
}

export class WhatsAppTestResultDto {
  @ApiProperty()
  accepted: boolean;

  @ApiPropertyOptional({ nullable: true, description: "Meta'nın mesaj kimliği" })
  providerMessageId: string | null;
}

/** Yalnız `/docs` üzerinde geçerli değerleri göstermek için. */
export const WHATSAPP_STATUSES = ['unconfigured', 'active', 'error'] as const;
export type WhatsAppStatusLiteral = (typeof WHATSAPP_STATUSES)[number];

export class WhatsAppStatusQueryDto {
  @ApiPropertyOptional({ enum: WHATSAPP_STATUSES })
  @IsOptional()
  @IsIn(WHATSAPP_STATUSES)
  status?: WhatsAppStatusLiteral;
}
