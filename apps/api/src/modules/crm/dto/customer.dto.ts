import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { CustomerGender } from '../../../database/schema/crm';

export const CUSTOMER_GENDERS = ['female', 'male', 'other', 'undisclosed'] as const;

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
}
