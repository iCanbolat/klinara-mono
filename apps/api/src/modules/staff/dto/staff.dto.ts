import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export class StaffServiceInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Null ise kiracı genel yetkinlik' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: 75 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  customDurationMinutes?: number;

  @ApiPropertyOptional({ example: 175000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  customPriceMinor?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class StaffServiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  staffProfileId: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  branchId: string | null;

  @ApiProperty({ nullable: true, type: Number })
  customDurationMinutes: number | null;

  @ApiProperty({ nullable: true, type: Number })
  customPriceMinor: number | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class StaffProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  userFullName: string;

  @ApiProperty()
  userEmail: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  primaryBranchId: string | null;

  @ApiProperty({ nullable: true, type: String })
  title: string | null;

  @ApiProperty({ type: [String] })
  specialties: string[];

  @ApiProperty({ nullable: true, type: String, example: '#1A6A7A' })
  calendarColor: string | null;

  @ApiProperty({ nullable: true, type: String })
  bio: string | null;

  @ApiProperty()
  isVisibleOnline: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: [StaffServiceResponseDto] })
  services: StaffServiceResponseDto[];
}

export class StaffListResponseDto {
  @ApiProperty({ type: [StaffProfileResponseDto] })
  data: StaffProfileResponseDto[];
}

export class CreateStaffProfileDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  primaryBranchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  specialties?: string[];

  @ApiPropertyOptional({ example: '#1A6A7A' })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN)
  calendarColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isVisibleOnline?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [StaffServiceInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffServiceInputDto)
  services?: StaffServiceInputDto[];
}

export class UpdateStaffProfileDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @IsOptional()
  @IsUUID()
  primaryBranchId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  specialties?: string[];

  @ApiPropertyOptional({ nullable: true, type: String, example: '#1A6A7A' })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN)
  calendarColor?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVisibleOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplaceStaffServicesDto {
  @ApiProperty({ type: [StaffServiceInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffServiceInputDto)
  services: StaffServiceInputDto[];
}
