import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  APPOINTMENT_CONSENT_STATUSES,
  CONSENT_LIMITS,
  SIGNATURE_KINDS,
  SIGNER_RELATIONS,
  type ConsentDocumentStatus,
  type SignatureKind,
  type SignerRelation,
} from '@klinara/shared';

// ---------------------------------------------------------------------------
// Şablonlar
// ---------------------------------------------------------------------------

export class ConsentTemplateVersionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  templateId: string;

  @ApiProperty({ nullable: true, type: Number, description: 'Taslakta null.' })
  version: number | null;

  @ApiProperty({ maxLength: CONSENT_LIMITS.body })
  body: string;

  @ApiProperty({ description: 'SUNUCU hesaplar.' })
  sha256: string;

  @ApiProperty({ enum: ['draft', 'published', 'archived'] })
  status: ConsentDocumentStatus;

  @ApiProperty({ nullable: true, type: String })
  publishedAt: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class ConsentTemplateVersionSummaryDto extends OmitType(ConsentTemplateVersionDto, [
  'body',
] as const) {}

export class ConsentTemplateDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Botoks uygulama onamı' })
  name: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'null: her randevuda yeniden imza. N: son N gündeki imza yeterli.',
  })
  validityDays: number | null;

  @ApiProperty()
  archived: boolean;

  @ApiProperty({ type: ConsentTemplateVersionDto, nullable: true })
  active: ConsentTemplateVersionDto | null;

  @ApiProperty({ type: ConsentTemplateVersionDto, nullable: true })
  draft: ConsentTemplateVersionDto | null;

  @ApiProperty({ type: [String], description: 'Bu onamı isteyen hizmetler.' })
  serviceIds: string[];

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class CreateConsentTemplateDto {
  @ApiProperty({ maxLength: CONSENT_LIMITS.templateName })
  @IsString()
  @MinLength(1)
  @MaxLength(CONSENT_LIMITS.templateName)
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: CONSENT_LIMITS.validityDays,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(CONSENT_LIMITS.validityDays)
  validityDays?: number | null;

  @ApiPropertyOptional({ maxLength: CONSENT_LIMITS.body, description: 'Verilirse ilk taslak.' })
  @IsOptional()
  @IsString()
  @MaxLength(CONSENT_LIMITS.body)
  body?: string;
}

export class UpdateConsentTemplateDto {
  @ApiPropertyOptional({ maxLength: CONSENT_LIMITS.templateName })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CONSENT_LIMITS.templateName)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: CONSENT_LIMITS.validityDays,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(CONSENT_LIMITS.validityDays)
  validityDays?: number | null;
}

export class UpdateConsentTemplateDraftDto {
  @ApiProperty({ maxLength: CONSENT_LIMITS.body })
  @IsString()
  @MinLength(1)
  @MaxLength(CONSENT_LIMITS.body)
  body: string;
}

export class SetServiceConsentTemplatesDto {
  @ApiProperty({
    type: [String],
    description: 'Hizmetin gerektirdiği şablonlar; liste TAMAMEN değiştirilir.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  templateIds: string[];
}

export class ServiceConsentTemplatesDto {
  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty({ type: [String] })
  templateIds: string[];
}

// ---------------------------------------------------------------------------
// Gereksinim
// ---------------------------------------------------------------------------

export class SignableConsentDocumentDto {
  @ApiProperty({ enum: SIGNATURE_KINDS })
  kind: SignatureKind;

  @ApiProperty({
    format: 'uuid',
    description: 'KVKK için onam metni id’si, işlem onamı için şablon SÜRÜMÜ id’si.',
  })
  documentId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  version: number;

  @ApiProperty()
  body: string;

  @ApiProperty({ description: 'İmza isteği bunu aynen geri gönderir.' })
  sha256: string;
}

export class ConsentRequirementItemDto {
  @ApiProperty({ enum: SIGNATURE_KINDS })
  kind: SignatureKind;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  templateId: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty()
  satisfied: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  signatureId: string | null;

  @ApiProperty({ type: SignableConsentDocumentDto, nullable: true })
  document: SignableConsentDocumentDto | null;
}

export class ConsentRequirementsDto {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  appointmentId: string | null;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty()
  customerName: string;

  @ApiProperty({ type: [ConsentRequirementItemDto] })
  items: ConsentRequirementItemDto[];

  @ApiProperty()
  missingCount: number;
}

export class AppointmentConsentStatusDto {
  @ApiProperty({ format: 'uuid' })
  appointmentId: string;

  @ApiProperty({ enum: APPOINTMENT_CONSENT_STATUSES })
  status: (typeof APPOINTMENT_CONSENT_STATUSES)[number];
}

export class AppointmentConsentStatusQueryDto {
  @ApiProperty({ description: 'Virgülle ayrılmış randevu id’leri (en fazla 500).' })
  @IsString()
  @Matches(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,499}$/i)
  ids: string;
}

// ---------------------------------------------------------------------------
// İmza
// ---------------------------------------------------------------------------

export class CreateConsentSignatureDto {
  @ApiProperty({ enum: SIGNATURE_KINDS })
  @IsIn(SIGNATURE_KINDS)
  kind: SignatureKind;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  documentId: string;

  @ApiProperty({ description: 'Hastaya gösterilen metnin sha256’sı.' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  textSha256: string;

  @ApiProperty({ maxLength: CONSENT_LIMITS.signerName })
  @IsString()
  @MinLength(2)
  @MaxLength(CONSENT_LIMITS.signerName)
  signerName: string;

  @ApiProperty({ enum: SIGNER_RELATIONS })
  @IsIn(SIGNER_RELATIONS)
  signerRelation: SignerRelation;

  @ApiPropertyOptional({
    maxLength: CONSENT_LIMITS.signerName,
    description: '`guardian` ise hastanın adı.',
  })
  @ValidateIf((dto: CreateConsentSignatureDto) => dto.signerRelation === 'guardian')
  @IsString()
  @MinLength(2)
  @MaxLength(CONSENT_LIMITS.signerName)
  guardianOfName?: string;

  @ApiProperty({ description: 'PNG, base64 (data URL öneki kabul edilir).' })
  @IsString()
  // Base64 ≈ 4/3 × bayt; öneki de sığdır.
  @MaxLength(Math.ceil((CONSENT_LIMITS.signaturePngBytes * 4) / 3) + 64)
  signaturePng: string;
}

export class ConsentSignatureCollectorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class ConsentSignatureSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: SIGNATURE_KINDS })
  kind: SignatureKind;

  @ApiProperty()
  documentTitle: string;

  @ApiProperty()
  documentVersion: number;

  @ApiProperty()
  signerName: string;

  @ApiProperty({ enum: SIGNER_RELATIONS })
  signerRelation: SignerRelation;

  @ApiProperty({ nullable: true, type: String })
  guardianOfName: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  customerId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  appointmentId: string | null;

  @ApiProperty({ type: ConsentSignatureCollectorDto, nullable: true })
  collectedBy: ConsentSignatureCollectorDto | null;

  @ApiProperty()
  signedAt: string;

  @ApiProperty()
  textSha256: string;

  @ApiProperty()
  pdfSha256: string;
}

export class ConsentSignatureDto extends ConsentSignatureSummaryDto {
  @ApiProperty({ description: 'Hastaya gösterilen metnin birebir kopyası.' })
  text: string;

  @ApiProperty()
  signatureSha256: string;

  @ApiProperty({ nullable: true, type: String })
  ip: string | null;

  @ApiProperty({ nullable: true, type: String })
  userAgent: string | null;
}

export class ConsentPdfUrlDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  expiresAt: string;
}
