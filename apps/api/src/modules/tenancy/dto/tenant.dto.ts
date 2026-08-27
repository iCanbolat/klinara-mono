import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

  @ApiPropertyOptional({ enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;
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
   * Yönetici rolleri (owner, manager, accountant) için 2FA zorunluluğu.
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

  /**
   * Davet token'ı — YALNIZ üretim dışında döner.
   *
   * E-posta gönderimi Batch 8.1'e kadar loga yazdığı için, geliştirme akışı
   * tıkanmasın diye yanıtta da veriliyor.
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
