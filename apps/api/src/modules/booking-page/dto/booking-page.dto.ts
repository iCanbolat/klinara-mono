import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { BookingOtpChannel } from '../../../database/schema';

export const BOOKING_SITE_STATUSES = ['draft', 'published', 'unpublished'] as const;

/**
 * Randevu anında gösterilen onam metni.
 *
 * Metnin kendisi burada duruyor çünkü Faz 7 (onam şablonları) bu fazdan SONRA
 * geliyor. 9.4 gösterilen metnin birebir kopyasını ve `sha256`'sını
 * `booking_consent_acceptances`a yazar; Batch 7.2 satırları `consent_records`a
 * taşır ve buradaki alan şablon referansına döner.
 */
export class ConsentTextDto {
  @ApiProperty({ example: 'kvkk_explicit', maxLength: 60 })
  @IsString()
  @MaxLength(60)
  kind: string;

  @ApiProperty({ maxLength: 8_000 })
  @IsString()
  @MaxLength(8_000)
  text: string;

  @ApiPropertyOptional({ default: true, description: 'İşaretlenmeden randevu alınamaz.' })
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class BookingSiteSettingsDto {
  @ApiProperty({ description: 'Sayfa üzerinden alınabilen en erken randevunun önden süresi (dk).' })
  minLeadMinutes: number;

  @ApiProperty()
  maxAdvanceDays: number;

  @ApiProperty()
  cancelWindowHours: number;

  @ApiProperty({ description: 'Bu üç değer kiracı ayarından mı geliyor.' })
  usesTenantDefaults: boolean;

  @ApiProperty()
  holdTtlMinutes: number;

  @ApiProperty()
  showStaffSelection: boolean;

  @ApiProperty()
  showPrices: boolean;

  @ApiProperty()
  allowReschedule: boolean;

  @ApiProperty()
  requireOtp: boolean;

  @ApiProperty({ enum: ['whatsapp', 'sms'] })
  otpChannel: BookingOtpChannel;

  @ApiProperty({ type: [ConsentTextDto] })
  consentTexts: ConsentTextDto[];

  @ApiProperty({ type: [String] })
  locales: string[];

  @ApiPropertyOptional({ nullable: true })
  contactEmail: string | null;
}

export class UpdateBookingPageDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Tek şubeli kiracıda şube seçimi ekranı atlanır.',
  })
  @IsOptional()
  @IsUUID()
  defaultBranchId?: string | null;

  /** `null` = kiracı ayarına düş. Alan hiç gönderilmezse mevcut değer korunur. */
  @ApiPropertyOptional({ minimum: 0, maximum: 43_200, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(43_200)
  minLeadMinutesOverride?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 730, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  maxAdvanceDaysOverride?: number | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 720, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  cancelWindowHoursOverride?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  holdTtlMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showStaffSelection?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showPrices?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowReschedule?: boolean;

  /**
   * OTP kapatılabilir ama varsayılan AÇIK.
   *
   * Kapalıyken sayfa doğrulanmamış telefonla randevu yazar; bu, no-show ve
   * sahte randevu riskini kliniğin kendi kararına bırakmak demek.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireOtp?: boolean;

  @ApiPropertyOptional({ enum: ['whatsapp', 'sms'] })
  @IsOptional()
  @IsIn(['whatsapp', 'sms'])
  otpChannel?: BookingOtpChannel;

  @ApiPropertyOptional({ type: [ConsentTextDto], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsentTextDto)
  consentTexts?: ConsentTextDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string | null;
}

export class BookingPageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'klinik-x', description: '`tenants.slug` ile senkron tutulur.' })
  slug: string;

  @ApiProperty({ enum: BOOKING_SITE_STATUSES })
  status: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  defaultBranchId: string | null;

  @ApiPropertyOptional({ nullable: true })
  publishedAt: string | null;

  @ApiProperty({ description: 'Kiracının kanonik adresi (birincil konak adı).' })
  canonicalUrl: string;

  @ApiProperty({ description: 'Yayınlanacak bir taslak içerik var mı.' })
  hasUnpublishedChanges: boolean;

  @ApiProperty({ type: BookingSiteSettingsDto })
  settings: BookingSiteSettingsDto;
}
