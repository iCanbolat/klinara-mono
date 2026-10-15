import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { PushEnvironment, PushPlatform } from '../../../lib/push/push.types';

export class RegisterPushDeviceDto {
  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform: PushPlatform;

  @ApiProperty({ description: 'APNs cihaz anahtarı (hex) ya da FCM kayıt anahtarı' })
  @IsString()
  @Length(1, 4096)
  token: string;

  @ApiPropertyOptional({
    enum: ['sandbox', 'production'],
    default: 'production',
    description: "Yalnız iOS: Xcode'dan kurulan derleme `sandbox`",
  })
  @IsOptional()
  @IsIn(['sandbox', 'production'])
  environment?: PushEnvironment;
}
