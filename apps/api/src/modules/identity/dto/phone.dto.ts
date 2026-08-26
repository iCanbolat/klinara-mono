import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class StartPhoneVerificationDto {
  @ApiProperty({ example: '0532 123 45 67', description: 'E.164’e normalize edilir' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone: string;
}

export class PhoneVerificationStartedDto {
  @ApiProperty({ example: '+905321234567' })
  phone: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  /**
   * SMS sağlayıcıya teslim edilebildi mi.
   *
   * `false` olması isteğin BAŞARISIZ olduğu anlamına gelmez: kod üretilmiştir,
   * kullanıcı yeniden gönderim isteyebilir. Sağlayıcı hatası isteği düşürmez.
   */
  @ApiProperty()
  delivered: boolean;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6, { message: '6 haneli olmalı' })
  code: string;
}

export class PhoneVerifiedDto {
  @ApiProperty({ example: '+905321234567' })
  phone: string;

  @ApiProperty({ format: 'date-time' })
  verifiedAt: string;
}
