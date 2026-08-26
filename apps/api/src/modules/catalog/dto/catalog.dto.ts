import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export class ServiceCategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ example: 'epilasyon' })
  slug: string;

  @ApiProperty({ example: 'Epilasyon' })
  name: string;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ServiceCategoryListResponseDto {
  @ApiProperty({ type: [ServiceCategoryResponseDto] })
  data: ServiceCategoryResponseDto[];
}

export class CreateServiceCategoryDto {
  @ApiProperty({ example: 'epilasyon' })
  @IsString()
  @Length(3, 50)
  @Matches(SLUG_PATTERN)
  slug: string;

  @ApiProperty({ example: 'Epilasyon' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateServiceCategoryDto {
  @ApiPropertyOptional({ example: 'epilasyon' })
  @IsOptional()
  @IsString()
  @Length(3, 50)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ example: 'Epilasyon' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BranchServiceOverrideInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({ example: 75 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferBeforeMinutes?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferAfterMinutes?: number;

  @ApiPropertyOptional({ example: 225000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @ApiPropertyOptional({ example: 2000, description: 'KDV oranı, bps (20% = 2000)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  vatRateBasisPoints?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnlineBookable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BranchServiceOverrideResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty({ format: 'uuid' })
  branchId: string;

  @ApiProperty({ nullable: true, type: Number })
  durationMinutes: number | null;

  @ApiProperty({ nullable: true, type: Number })
  bufferBeforeMinutes: number | null;

  @ApiProperty({ nullable: true, type: Number })
  bufferAfterMinutes: number | null;

  @ApiProperty({ nullable: true, type: Number })
  priceMinor: number | null;

  @ApiProperty({ nullable: true, type: Number })
  vatRateBasisPoints: number | null;

  @ApiProperty({ nullable: true, type: Boolean })
  isOnlineBookable: boolean | null;

  @ApiProperty({ nullable: true, type: Boolean })
  isActive: boolean | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  categoryId: string;

  @ApiProperty({ example: 'tum-vucut-lazer' })
  slug: string;

  @ApiProperty({ example: 'Tüm Vücut Lazer' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: 60 })
  durationMinutes: number;

  @ApiProperty({ example: 5 })
  bufferBeforeMinutes: number;

  @ApiProperty({ example: 10 })
  bufferAfterMinutes: number;

  @ApiProperty({ example: 150000 })
  priceMinor: number;

  @ApiProperty({ example: 2000 })
  vatRateBasisPoints: number;

  @ApiProperty({ nullable: true, type: String, example: '#1A6A7A' })
  calendarColor: string | null;

  @ApiProperty()
  isOnlineBookable: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: [BranchServiceOverrideResponseDto] })
  branchOverrides: BranchServiceOverrideResponseDto[];
}

export class ServiceListResponseDto {
  @ApiProperty({ type: [ServiceResponseDto] })
  data: ServiceResponseDto[];
}

export class CreateServiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 'tum-vucut-lazer' })
  @IsString()
  @Length(3, 50)
  @Matches(SLUG_PATTERN)
  slug: string;

  @ApiProperty({ example: 'Tüm Vücut Lazer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferBeforeMinutes?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferAfterMinutes?: number;

  @ApiProperty({ example: 150000 })
  @IsInt()
  @Min(0)
  priceMinor: number;

  @ApiPropertyOptional({ example: 2000, default: 2000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  vatRateBasisPoints?: number;

  @ApiPropertyOptional({ example: '#1A6A7A' })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN)
  calendarColor?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isOnlineBookable?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [BranchServiceOverrideInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchServiceOverrideInputDto)
  branchOverrides?: BranchServiceOverrideInputDto[];
}

export class UpdateServiceDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'tum-vucut-lazer' })
  @IsOptional()
  @IsString()
  @Length(3, 50)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ example: 'Tüm Vücut Lazer' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferBeforeMinutes?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferAfterMinutes?: number;

  @ApiPropertyOptional({ example: 150000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @ApiPropertyOptional({ example: 2000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  vatRateBasisPoints?: number;

  @ApiPropertyOptional({ nullable: true, type: String, example: '#1A6A7A' })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN)
  calendarColor?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnlineBookable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [BranchServiceOverrideInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchServiceOverrideInputDto)
  branchOverrides?: BranchServiceOverrideInputDto[];
}
