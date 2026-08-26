import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthTokensDto {
  @ApiProperty()
  accessToken: string;

  /** Opak token; veritabanında yalnız sha256 özeti durur. */
  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ description: 'Access token ömrü (saniye)', example: 900 })
  expiresIn: number;
}

export class TenantOptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: [String] })
  roles: string[];
}

export class MfaChallengeDto {
  @ApiProperty({ description: 'Kullanıcı TOTP kurulumunu tamamlamış mı' })
  configured: boolean;

  @ApiProperty({ type: [String], example: ['totp', 'backup_code'] })
  methods: string[];
}

export class SelectedTenantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
}

/**
 * Giriş yanıtı — üç durumdan biri.
 *
 * `authenticated` dışındaki durumlarda `tokens` YOKTUR: kiracı seçilmeden veya
 * ikinci faktör doğrulanmadan hiçbir veriye erişim verilmez.
 */
export class LoginResponseDto {
  @ApiProperty({ enum: ['authenticated', 'tenant_selection_required', 'mfa_required'] })
  status: 'authenticated' | 'tenant_selection_required' | 'mfa_required';

  @ApiPropertyOptional({ type: AuthTokensDto })
  tokens?: AuthTokensDto;

  @ApiPropertyOptional({ description: 'Ara token (kiracı seçimi veya 2FA)' })
  challengeToken?: string;

  @ApiPropertyOptional({ type: [TenantOptionDto] })
  tenants?: TenantOptionDto[];

  @ApiPropertyOptional({ type: MfaChallengeDto })
  mfa?: MfaChallengeDto;

  @ApiPropertyOptional({ type: SelectedTenantDto })
  tenant?: SelectedTenantDto;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Bu istek bu oturumdan mı geliyor' })
  current: boolean;

  @ApiProperty({ enum: ['password', 'passkey', 'invitation', 'password_reset'] })
  authMethod: string;

  @ApiProperty({ nullable: true, type: String })
  mfaMethod: string | null;

  @ApiProperty({ nullable: true, type: String })
  deviceLabel: string | null;

  @ApiProperty({ nullable: true, type: String })
  ip: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  lastUsedAt: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

export class SessionListResponseDto {
  @ApiProperty({ type: [SessionResponseDto] })
  data: SessionResponseDto[];
}
