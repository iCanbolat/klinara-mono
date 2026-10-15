import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PLAN_KEYS, SETUP_STEP_KEYS, type PlanKey, type SetupStepKey } from '@klinara/shared';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsTimeZone,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Kiracı ve şube kodları URL'de görünür: yalnız küçük harf, rakam ve tire. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/;
/** Mesaja yazılan bağlantı: yalnız https (veritabanı kısıtıyla aynı kural). */
const HTTPS_URL = /^https:\/\/\S+$/i;
const SLUG_MESSAGE = 'Yalnız küçük harf, rakam ve tire; tire ile başlayamaz/bitemez';

const TENANT_STATUSES = ['trial', 'active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export class CreateTenantBranchDto {
  @ApiProperty({ example: 'merkez' })
  @IsString()
  @Length(3, 50)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug: string;

  @ApiProperty({ example: 'Merkez Şube' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Europe/Istanbul' })
  @IsOptional()
  @IsTimeZone({ message: 'Geçerli bir IANA saat dilimi olmalı (ör. Europe/Istanbul)' })
  timezone?: string;
}

export class CreateTenantOwnerDto {
  @ApiProperty({ example: 'sahip@klinik.com' })
  @IsEmail({}, { message: 'Geçerli bir e-posta olmalı' })
  email: string;

  @ApiPropertyOptional({ example: 'Ayşe Yılmaz' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;
}

export class CreateTenantDto {
  @ApiProperty({ example: 'guzellik-merkezi' })
  @IsString()
  @Length(3, 50)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug: string;

  @ApiProperty({ example: 'Güzellik Merkezi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ default: 'Europe/Istanbul' })
  @IsTimeZone({ message: 'Geçerli bir IANA saat dilimi olmalı (ör. Europe/Istanbul)' })
  timezone: string = 'Europe/Istanbul';

  @ApiPropertyOptional({ default: 'TRY' })
  @IsString()
  @Length(3, 3)
  currency: string = 'TRY';

  /** İlk şube kiracıyla birlikte oluşturulur — şubesiz kiracı iş göremez. */
  @ApiProperty({ type: CreateTenantBranchDto })
  @ValidateNested()
  @Type(() => CreateTenantBranchDto)
  branch: CreateTenantBranchDto;

  /**
   * İşletme sahibi daveti.
   *
   * Kiracı ile birlikte oluşturulur, çünkü sahipsiz bir kiracıya KİMSE giriş
   * yapamaz — platform yöneticisinin kiracı verisine erişimi yoktur ve olmamalıdır.
   */
  @ApiProperty({ type: CreateTenantOwnerDto })
  @ValidateNested()
  @Type(() => CreateTenantOwnerDto)
  owner: CreateTenantOwnerDto;

  /** Abonelik planı; ödeme altyapısı olmadığından platform yöneticisi atar. */
  @ApiPropertyOptional({ enum: PLAN_KEYS, default: 'klinik' })
  @IsOptional()
  @IsIn(PLAN_KEYS)
  planKey?: PlanKey;

  /** Kiracıya özel limit (ör. Özel plan); verilmezse planın limiti geçerli. */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxBranchesOverride?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  maxPractitionersOverride?: number;
}

export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsTimeZone({ message: 'Geçerli bir IANA saat dilimi olmalı (ör. Europe/Istanbul)' })
  timezone?: string;

  // `status` burada YOK: askıya alma ve deneme/aktif geçişi platform
  // yöneticisinin kararı (`PATCH /platform/tenants/:id`). Kiracı kendi
  // durumunu değiştirebilseydi askıyı kendisi kaldırabilirdi.
}

export class TenantResponseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: TENANT_STATUSES })
  status: TenantStatus;

  @ApiProperty()
  timezone: string;

  @ApiProperty({ example: 'TRY' })
  currency: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({ enum: [5, 10, 15, 20, 30, 60] })
  @IsOptional()
  @IsIn([5, 10, 15, 20, 30, 60])
  slotGranularityMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preventCustomerDoubleBooking?: boolean;

  @ApiPropertyOptional({ type: [Number], example: [24, 2] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(720, { each: true })
  reminderHoursBefore?: number[];

  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  cancelWindowHours?: number;

  @ApiPropertyOptional({ example: 60, description: 'Randevu için minimum önden süre (dk)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(43200)
  minLeadMinutes?: number;

  @ApiPropertyOptional({ example: 180, description: 'Kaç gün ileriye randevu alınabilir' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  maxAdvanceDays?: number;

  /**
   * Yönetici rolleri (owner, manager) için 2FA zorunluluğu.
   *
   * Açıldığında, TOTP'si olmayan yöneticiler girişte kurulum akışına düşer;
   * doğrulanmadan tam yetkili token ALMAZLAR.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireMfaForAdmins?: boolean;
}

export class TenantSettingsResponseDto {
  @ApiProperty({ example: 15 })
  slotGranularityMinutes: number;

  @ApiProperty()
  preventCustomerDoubleBooking: boolean;

  @ApiProperty({ type: [Number], example: [24, 2] })
  reminderHoursBefore: number[];

  @ApiProperty({ example: 24 })
  cancelWindowHours: number;

  @ApiProperty({ example: 60 })
  minLeadMinutes: number;

  @ApiProperty({ example: 180 })
  maxAdvanceDays: number;

  @ApiProperty()
  requireMfaForAdmins: boolean;
}

export class BranchResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  timezone: string;

  @ApiProperty({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ nullable: true, type: String })
  address: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Google Maps bağlantısı (https). Şube bilgisi; mesajlarda kullanılmaz (harita butonu adresten üretilir).',
  })
  mapsUrl: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class TenantOwnerInvitationDto {
  @ApiProperty()
  email: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  /** Davet e-postası sağlayıcıya teslim edildi mi; yalnız oluşturma yanıtında. */
  @ApiPropertyOptional()
  mailDelivered?: boolean;

  /**
   * Davet token'ı — YALNIZ üretim dışında döner.
   *
   * Yerelde e-posta çoğu zaman loga yazıldığı için geliştirme akışı
   * tıkanmasın diye yanıtta da verilir. Üretimde bu alan hiç görünmez.
   */
  @ApiPropertyOptional()
  token?: string;

  @ApiPropertyOptional()
  link?: string;
}

export class CreateTenantResponseDto {
  @ApiProperty({ type: TenantResponseDto })
  tenant: TenantResponseDto;

  @ApiProperty({ type: BranchResponseDto })
  branch: BranchResponseDto;

  @ApiProperty({ type: TenantOwnerInvitationDto })
  ownerInvitation: TenantOwnerInvitationDto;
}

export class BranchListResponseDto {
  @ApiProperty({ type: [BranchResponseDto] })
  data: BranchResponseDto[];
}

export class CreateBranchDto {
  @ApiProperty({ example: 'kadikoy' })
  @IsString()
  @Length(3, 50)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug: string;

  @ApiProperty({ example: 'Kadıköy Şube' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsTimeZone({ message: 'Geçerli bir IANA saat dilimi olmalı (ör. Europe/Istanbul)' })
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ description: 'Google Maps bağlantısı; yalnız https.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(HTTPS_URL, { message: "'https://' ile başlayan bir bağlantı olmalı" })
  mapsUrl?: string;
}

export class UpdateBranchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsTimeZone({ message: 'Geçerli bir IANA saat dilimi olmalı (ör. Europe/Istanbul)' })
  timezone?: string;

  /** `null` gönderildiğinde alan temizlenir. */
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  /** `null` gönderildiğinde bağlantı temizlenir. */
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(HTTPS_URL, { message: "'https://' ile başlayan bir bağlantı olmalı" })
  mapsUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Plan ve kurulum durumu
// ---------------------------------------------------------------------------

export class PlanLimitsDto {
  @ApiProperty()
  maxBranches: number;

  @ApiProperty()
  maxPractitioners: number;
}

export class PlanUsageDto {
  @ApiProperty()
  branches: number;

  @ApiProperty({ description: 'Aktif personel profili sayısı' })
  practitioners: number;
}

export class TenantPlanResponseDto {
  @ApiProperty({ enum: PLAN_KEYS })
  planKey: PlanKey;

  @ApiProperty()
  planName: string;

  @ApiProperty({ type: PlanLimitsDto })
  limits: PlanLimitsDto;

  @ApiProperty({ type: PlanUsageDto })
  usage: PlanUsageDto;
}

export class SetupStepDto {
  @ApiProperty({ enum: SETUP_STEP_KEYS })
  key: SetupStepKey;

  @ApiProperty()
  done: boolean;
}

export class TenantSetupStatusDto {
  @ApiProperty({ type: [SetupStepDto] })
  steps: SetupStepDto[];

  @ApiProperty()
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Platform yöneticisi
// ---------------------------------------------------------------------------

export class UpdatePlatformTenantDto {
  @ApiPropertyOptional({ enum: PLAN_KEYS })
  @IsOptional()
  @IsIn(PLAN_KEYS)
  planKey?: PlanKey;

  @ApiPropertyOptional({ enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;

  /** `null` override'ı kaldırır, planın limiti geçerli olur. */
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxBranchesOverride?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  maxPractitionersOverride?: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  planNote?: string | null;
}

export class PlatformOwnerInvitationStatusDto {
  @ApiProperty()
  email: string;

  @ApiProperty({ enum: ['pending', 'accepted', 'expired', 'revoked'] })
  state: 'pending' | 'accepted' | 'expired' | 'revoked';

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

export class PlatformTenantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: TENANT_STATUSES })
  status: TenantStatus;

  @ApiProperty({ enum: PLAN_KEYS })
  planKey: PlanKey;

  @ApiProperty({ nullable: true, type: Number })
  maxBranchesOverride: number | null;

  @ApiProperty({ nullable: true, type: Number })
  maxPractitionersOverride: number | null;

  @ApiProperty({ nullable: true, type: String })
  planNote: string | null;

  @ApiProperty({ type: PlanLimitsDto })
  limits: PlanLimitsDto;

  @ApiProperty({ type: PlanUsageDto })
  usage: PlanUsageDto;

  @ApiProperty({ type: PlatformOwnerInvitationStatusDto, nullable: true })
  ownerInvitation: PlatformOwnerInvitationStatusDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class PlatformTenantListDto {
  @ApiProperty({ type: [PlatformTenantDto] })
  data: PlatformTenantDto[];
}

export class PlatformTenantDetailDto extends PlatformTenantDto {
  @ApiProperty({ type: [BranchResponseDto] })
  branches: BranchResponseDto[];

  @ApiProperty({ type: TenantSetupStatusDto })
  setup: TenantSetupStatusDto;
}

export class PlatformOwnerInvitationResendDto {
  @ApiPropertyOptional({ format: 'email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}
