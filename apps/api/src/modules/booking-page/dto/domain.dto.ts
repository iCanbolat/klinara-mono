import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { BookingDomainKind, DomainVerificationStatus } from '../../../database/schema';

export class CreateDomainDto {
  /**
   * Ham konak adı. Normalizasyon (küçük harf, port/nokta kırpma, IDN →
   * punycode) SUNUCUDA yapılır; istemcinin gönderdiği biçim kanonik kabul
   * edilmez.
   */
  @ApiProperty({ example: 'randevu.klinikx.com', maxLength: 253 })
  @IsString()
  @MaxLength(253)
  host: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Doğrulandığında kanonik adres bu olsun mu.',
  })
  @IsOptional()
  @IsBoolean()
  makePrimary?: boolean;
}

export class DomainDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'randevu.klinikx.com' })
  host: string;

  @ApiProperty({ enum: ['platform_subdomain', 'custom'] })
  kind: BookingDomainKind;

  @ApiProperty({ enum: ['pending', 'dns_verified', 'active', 'failed', 'disabled'] })
  verificationStatus: DomainVerificationStatus;

  @ApiProperty()
  isPrimary: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Neden doğrulanamadı.' })
  failureReason: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastCheckedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  verifiedAt: string | null;

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description:
      'DNS sağlayıcısına girilecek kayıtlar. Yalnız doğrulanmamış özel alan adlarında dolu; kullanıcı bu değerleri elle YAZMAMALI.',
  })
  dnsInstructions: DnsInstructionsDto | null;
}

export class DnsInstructionsDto {
  @ApiProperty({ example: '_klinara-verify.randevu.klinikx.com' })
  txtName: string;

  @ApiProperty({ example: 'k9f3c1a2b…' })
  txtValue: string;

  @ApiProperty({ example: 'randevu.klinikx.com' })
  cnameName: string;

  @ApiProperty({ example: 'klinik-x.klinara.app' })
  cnameValue: string;
}
