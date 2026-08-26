import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class TotpSetupResponseDto {
  @ApiProperty({ description: 'Base32 sır — kullanıcı QR okuyamazsa elle girer' })
  secret: string;

  @ApiProperty({ example: 'otpauth://totp/Klinara:ayse@klinik.com?secret=...' })
  otpauthUri: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456', description: 'TOTP kodu veya yedek kod' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;
}

export class VerifyMfaDto {
  @ApiProperty({ description: 'Giriş yanıtındaki `challengeToken`' })
  @IsString()
  @IsNotEmpty()
  challengeToken: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 30)
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}

export class BackupCodesResponseDto {
  @ApiProperty({ type: [String], description: 'Yalnız BİR KEZ gösterilir' })
  backupCodes: string[];
}

export class TotpStatusResponseDto {
  @ApiProperty()
  enabled: boolean;

  @ApiProperty()
  backupCodesRemaining: number;
}
