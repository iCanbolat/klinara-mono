import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateHoldDto {
  @ApiProperty({ description: 'Uygunluk ucundan gelen opak slot token’ı.' })
  @IsString()
  @MaxLength(2_000)
  slotToken: string;
}

export class HoldResponseDto {
  @ApiProperty({ description: 'Sonraki adımların taşıyacağı tutma anahtarı.' })
  holdToken: string;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty({ format: 'date-time', description: 'Tutma bu ana kadar geçerli.' })
  expiresAt: string;

  @ApiProperty({ description: 'Randevu oluşturmadan önce telefon doğrulaması gerekiyor mu.' })
  otpRequired: boolean;

  @ApiProperty()
  otpVerified: boolean;
}

export class RequestOtpDto {
  /**
   * E.164'e SUNUCUDA normalize edilir. İstemcinin gönderdiği biçim
   * (`0532...`, `+90 532 ...`) kanonik kabul edilmez — mükerrer müşteri
   * kaydının en yaygın sebebi tam olarak budur.
   */
  @ApiProperty({ example: '+905321234567' })
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{4,8}$/)
  code: string;
}

export class ConsentAcceptanceDto {
  @ApiProperty({ example: 'kvkk_explicit' })
  @IsString()
  @MaxLength(60)
  kind: string;

  /**
   * İstemcinin GÖRDÜĞÜ metnin hash'i.
   *
   * Sunucu bunu kendi ayarından hesapladığıyla karşılaştırır ve eşleşmezse
   * reddeder. Böylece "müşteriye ne gösterildi" sorusu, ayarlar sonradan
   * değişse bile cevaplanabilir kalıyor.
   */
  @ApiProperty({ example: '9f3c…', description: 'Gösterilen metnin sha256’sı.' })
  @Matches(/^[0-9a-f]{64}$/)
  textSha256: string;
}

export class PublicCreateAppointmentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2_000)
  holdToken: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: ['female', 'male', 'other', 'undisclosed'] })
  @IsOptional()
  @IsIn(['female', 'male', 'other', 'undisclosed'])
  gender?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Müşterinin notu.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [ConsentAcceptanceDto], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ConsentAcceptanceDto)
  consents: ConsentAcceptanceDto[];
}

export class PublicAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ type: [String] })
  serviceNames: string[];

  @ApiProperty({ description: 'Randevuyu görüntüleme / iptal / erteleme bağlantısı.' })
  manageToken: string;

  @ApiProperty()
  branchName: string;

  @ApiPropertyOptional({ nullable: true })
  branchAddress: string | null;

  @ApiPropertyOptional({ nullable: true })
  branchPhone: string | null;
}

export class PublicAppointmentIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}
