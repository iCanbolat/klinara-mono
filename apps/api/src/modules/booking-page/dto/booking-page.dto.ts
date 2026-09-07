import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { BookingOtpChannel } from '../../../database/schema';

export const BOOKING_SITE_STATUSES = ['draft', 'published', 'unpublished'] as const;

/**
 * Yayındaki onam metninin ÖZETİ — ayarların parçası, ama SALT OKUNUR.
 *
 * Metin ve sürüm geçmişi `/consent-document` ucundan yönetiliyor: onam metni
 * bir ayar değil, sürümlü ve yayınlandıktan sonra değişmez bir belge. Ayarlar
 * kaydedilirken yanlışlıkla üzerine yazılabilmesi bunun tam tersi olurdu.
 */
export class ActiveConsentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 3 })
  version: number;

  @ApiProperty({ example: 'tr' })
  locale: string;

  @ApiProperty()
  sha256: string;

  @ApiProperty()
  publishedAt: string;
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

  @ApiProperty({
    type: ActiveConsentSummaryDto,
    nullable: true,
    description: 'Yayında onam metni yoksa `null` — bu hâlde site YAYINLANAMAZ.',
  })
  consent: ActiveConsentSummaryDto | null;

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
