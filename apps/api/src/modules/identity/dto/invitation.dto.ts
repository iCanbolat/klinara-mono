import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASSIGNABLE_ROLES } from '@klinara/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from './auth.dto';

/**
 * Uygulayıcı davetinde kabulle birlikte açılacak personel profili.
 *
 * Profil, takvimde randevu alabilen kişiyi tanımlar; davet kabul edilince
 * üyelikle aynı transaction'da oluşur.
 */
export class InvitationStaffProfileDto {
  @ApiPropertyOptional({ example: 'Dermatolog' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isVisibleOnline?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Yetkin olduğu hizmetler' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  serviceIds?: string[];
}

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

  /** Yalnız `practitioner` rolünde; kabulde personel profili olarak açılır. */
  @ApiPropertyOptional({ type: InvitationStaffProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InvitationStaffProfileDto)
  staffProfile?: InvitationStaffProfileDto;
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
