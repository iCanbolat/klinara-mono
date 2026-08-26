import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

/** Parola alt sınırı. Uzunluk, karmaşıklık kurallarından daha etkilidir. */
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

export class LoginDto {
  /**
   * Web'in birincil tanımlayıcısı. `phone` ile birlikte GÖNDERİLMEZ —
   * ikisinden tam olarak biri beklenir (kontrol serviste, çünkü koşul
   * alanlar arasıdır).
   */
  @ApiPropertyOptional({ example: 'ayse@klinik.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Geçerli bir e-posta olmalı' })
  email?: string;

  /** Mobilin birincil tanımlayıcısı. Yalnız DOĞRULANMIŞ numara kabul edilir. */
  @ApiPropertyOptional({ example: '+905321234567' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({ example: 'cok-gizli-parola' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password: string;

  /** Oturum listesinde görünecek cihaz adı (ör. "iPhone 15"). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}

export class SelectTenantDto {
  @ApiProperty({ description: 'Giriş yanıtındaki `challengeToken`' })
  @IsString()
  @IsNotEmpty()
  challengeToken: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tenantId: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Geçerli bir e-posta olmalı' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: PASSWORD_MIN })
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX, { message: `En az ${PASSWORD_MIN} karakter olmalı` })
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ minLength: PASSWORD_MIN })
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX, { message: `En az ${PASSWORD_MIN} karakter olmalı` })
  newPassword: string;
}

export { PASSWORD_MIN, PASSWORD_MAX };
