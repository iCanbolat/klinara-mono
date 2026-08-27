import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { CustomerGender, CustomerSource } from '../../../database/schema/crm';

export const CUSTOMER_GENDERS = ['female', 'male', 'other', 'undisclosed'] as const;

export const CUSTOMER_SOURCES = [
  'walk_in',
  'referral',
  'instagram',
  'google',
  'website',
  'whatsapp',
  'other',
] as const;

export class CustomerTagResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'VIP' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: '#c0392b' })
  color: string | null;
}

export class CustomerResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ example: 'Ayşe Yılmaz' })
  fullName: string;

  @ApiProperty({ nullable: true, type: String, example: '+905321234567' })
  phone: string | null;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: String, example: '1990-05-12' })
  birthDate: string | null;

  @ApiProperty({ nullable: true, type: String, enum: CUSTOMER_GENDERS })
  gender: CustomerGender | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ nullable: true, type: String })
  addressLine: string | null;

  @ApiProperty({ nullable: true, type: String })
  district: string | null;

  @ApiProperty({ nullable: true, type: String })
  city: string | null;

  @ApiProperty({ nullable: true, type: String })
  postalCode: string | null;

  @ApiProperty({ nullable: true, type: String, enum: CUSTOMER_SOURCES })
  source: CustomerSource | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'uuid',
    description: 'Bu kayıt birleştirildiyse hayatta kalan kaydın kimliği.',
  })
  mergedIntoCustomerId: string | null;

  @ApiProperty({ type: [CustomerTagResponseDto] })
  tags: CustomerTagResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class CustomerListResponseDto {
  @ApiProperty({ type: [CustomerResponseDto] })
  data: CustomerResponseDto[];
}

export class CreateCustomerDto {
  @ApiProperty({ example: 'Ayşe Yılmaz' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName: string;

  @ApiPropertyOptional({
    example: '0532 123 45 67',
    description: 'Serbest biçimde gönderilebilir; sunucu E.164’e normalize eder.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'ayse@ornek.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ example: '1990-05-12' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_GENDERS })
  @IsOptional()
  @IsIn(CUSTOMER_GENDERS)
  gender?: CustomerGender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;

  @ApiPropertyOptional({ example: 'Kadıköy' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: 'İstanbul' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: '34710' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_SOURCES })
  @IsOptional()
  @IsIn(CUSTOMER_SOURCES)
  source?: CustomerSource;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: 'Ayşe Yılmaz' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: '0532 123 45 67' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '1990-05-12' })
  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @ApiPropertyOptional({ enum: CUSTOMER_GENDERS })
  @IsOptional()
  @IsIn(CUSTOMER_GENDERS)
  gender?: CustomerGender;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, enum: CUSTOMER_SOURCES })
  @IsOptional()
  @IsIn(CUSTOMER_SOURCES)
  source?: CustomerSource | null;
}

export class CustomerTagListResponseDto {
  @ApiProperty({ type: [CustomerTagResponseDto] })
  data: CustomerTagResponseDto[];
}

export class CustomerTagInputDto {
  @ApiProperty({ example: 'VIP' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: '#c0392b' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Renk #RRGGBB biçiminde olmalı' })
  color?: string | null;
}

export class UpdateCustomerTagDto {
  @ApiPropertyOptional({ example: 'VIP' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: '#c0392b' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Renk #RRGGBB biçiminde olmalı' })
  color?: string | null;
}

export class PutCustomerTagsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  tagIds: string[];
}

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Önceki sayfanın `pageInfo.nextCursor` değeri' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Yalnız bu etikete sahip müşteriler' })
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_SOURCES })
  @IsOptional()
  @IsIn(CUSTOMER_SOURCES)
  source?: CustomerSource;
}

export class SearchCustomersQueryDto {
  @ApiProperty({ example: 'yılmaz', minLength: 2 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class MergeCustomerDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Birleştirilecek (arşivlenecek) mükerrer kayıt. Yoldaki kimlik HAYATTA KALIR.',
  })
  @IsUUID()
  sourceCustomerId: string;
}

export class CustomerMergeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  sourceCustomerId: string;

  @ApiProperty({ format: 'uuid' })
  targetCustomerId: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { appointments: 12, customer_bookings: 12, customer_tag_assignments: 2 },
    description: 'Tablo adı → taşınan satır sayısı',
  })
  moved: Record<string, number>;

  @ApiProperty({ type: CustomerResponseDto })
  customer: CustomerResponseDto;
}

export class PageInfoDto {
  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

export class CustomerPageDto {
  @ApiProperty({ type: [CustomerResponseDto] })
  data: CustomerResponseDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo: PageInfoDto;
}
