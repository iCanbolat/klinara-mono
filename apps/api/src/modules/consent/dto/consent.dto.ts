import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CONSENT_LIMITS, type ConsentDocumentStatus } from '@klinara/shared';

export class ConsentDocumentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'kvkk_explicit' })
  kind: string;

  @ApiProperty({ example: 3, nullable: true, description: 'Taslakta null — sürüm yayın anında verilir.' })
  version: number | null;

  @ApiProperty({ example: 'tr' })
  locale: string;

  @ApiProperty({ maxLength: CONSENT_LIMITS.body })
  body: string;

  @ApiProperty({ description: 'Metnin sha256’sı — SUNUCU hesaplar.' })
  sha256: string;

  @ApiProperty({ enum: ['draft', 'published', 'archived'] })
  status: ConsentDocumentStatus;

  @ApiProperty({ nullable: true })
  publishedAt: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

/** Sürüm listesinde gövde YOK: 20k'lık metinleri listeye taşımanın anlamı yok. */
export class ConsentDocumentSummaryDto extends OmitType(ConsentDocumentDto, ['body'] as const) {}

export class ConsentDocumentStateDto {
  @ApiProperty({ type: ConsentDocumentDto, nullable: true })
  active: ConsentDocumentDto | null;

  @ApiProperty({ type: ConsentDocumentDto, nullable: true })
  draft: ConsentDocumentDto | null;
}

export class UpdateConsentDraftDto {
  @ApiProperty({ maxLength: CONSENT_LIMITS.body })
  @IsString()
  @MinLength(1)
  @MaxLength(CONSENT_LIMITS.body)
  body: string;

  @ApiPropertyOptional({ default: 'tr', enum: ['tr', 'en'] })
  @IsOptional()
  @IsIn(['tr', 'en'])
  locale?: string;
}

export class ConsentAcceptanceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  appointmentId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  customerId: string | null;

  @ApiProperty()
  kind: string;

  @ApiProperty({ nullable: true, description: '0043 öncesi kayıtlarda null.' })
  version: number | null;

  @ApiProperty({ nullable: true })
  locale: string | null;

  @ApiProperty({ description: 'Müşteriye gösterilen metnin BİREBİR kopyası.' })
  text: string;

  @ApiProperty()
  textSha256: string;

  @ApiProperty()
  acceptedAt: string;

  @ApiProperty({ nullable: true })
  ip: string | null;

  @ApiProperty({ nullable: true })
  userAgent: string | null;
}

export class ConsentAcceptanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}
