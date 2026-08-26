import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * WebAuthn yanıt gövdeleri.
 *
 * İçerik tarayıcı/işletim sistemi tarafından üretilir ve şeması W3C
 * standardınındır; DTO burada yalnız "nesne mi" kontrolü yapar, asıl doğrulama
 * `@simplewebauthn/server` tarafından KRİPTOGRAFİK olarak yapılır.
 */
export class RegisterPasskeyDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  response: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'iPhone 15' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}

export class PasskeyAuthOptionsDto {
  @ApiPropertyOptional({ description: 'Verilmezse discoverable credential akışı' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class VerifyPasskeyDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  response: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}

export class RenamePasskeyDto {
  @ApiProperty({ example: 'İş telefonu' })
  @IsString()
  @MaxLength(100)
  deviceLabel: string;
}

export class PasskeyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  deviceLabel: string;

  @ApiProperty({ description: 'Anahtar buluta yedekleniyor mu (senkron passkey)' })
  backedUp: boolean;

  @ApiProperty({ type: [String] })
  transports: string[];

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastUsedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class PasskeyListResponseDto {
  @ApiProperty({ type: [PasskeyResponseDto] })
  data: PasskeyResponseDto[];
}
