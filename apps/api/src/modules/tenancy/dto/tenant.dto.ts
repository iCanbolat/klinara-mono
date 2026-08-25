import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Length,
  Matches,
  MaxLength,
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

export class TenantSettingsResponseDto {
  @ApiProperty({ example: 15 })
  slotGranularityMinutes: number;

  @ApiProperty()
  preventCustomerDoubleBooking: boolean;

  @ApiProperty({ type: [Number], example: [24, 2] })
  reminderHoursBefore: number[];

  @ApiProperty({ example: 24 })
  cancelWindowHours: number;
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

export class CreateTenantResponseDto {
  @ApiProperty({ type: TenantResponseDto })
  tenant: TenantResponseDto;

  @ApiProperty({ type: BranchResponseDto })
  branch: BranchResponseDto;
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
