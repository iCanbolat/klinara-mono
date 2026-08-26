import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASSIGNABLE_ROLES } from '@klinara/shared';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from './auth.dto';

export class CreateInvitationDto {
  @ApiProperty({ example: 'yeni@klinik.com' })
  @IsEmail({}, { message: 'Geçerli bir e-posta olmalı' })
  email: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES, { message: 'Tanımlı bir kiracı rolü olmalı' })
  roleKey: string;

  /** Şube kapsamlı roller (manager, receptionist, practitioner) için zorunlu. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;
}

export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  roleKey: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  branchId: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  acceptedAt?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  revokedAt?: string | null;

  /**
   * Davet token'ı — YALNIZ üretim dışında döner.
   *
   * E-posta gönderimi Batch 8.1'e kadar loga yazdığı için geliştirme akışının
   * tıkanmaması adına yanıtta da veriliyor. Üretimde bu alan hiç görünmez.
   */
  @ApiPropertyOptional()
  token?: string;

  @ApiPropertyOptional()
  link?: string;
}

export class InvitationListResponseDto {
  @ApiProperty({ type: [InvitationResponseDto] })
  data: InvitationResponseDto[];
}

/** Davet ekranının gördüğü kadarı — kiracının başka verisi sızmaz. */
export class InvitationPreviewDto {
  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true, type: String })
  fullName: string | null;

  @ApiProperty()
  tenantName: string;

  @ApiProperty()
  roleKey: string;

  @ApiProperty()
  roleName: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  /** Hesap zaten varsa istemci parola sormaz, girişe yönlendirir. */
  @ApiProperty()
  accountExists: boolean;
}

export class AcceptInvitationDto {
  @ApiPropertyOptional({
    minLength: PASSWORD_MIN,
    description: 'Yeni hesap için zorunlu; mevcut hesapta yok sayılır',
  })
  @IsOptional()
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX, { message: `En az ${PASSWORD_MIN} karakter olmalı` })
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;
}
