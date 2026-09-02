import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import type { TenantAssetPurpose } from '../../../database/schema';

export const ASSET_PURPOSES = [
  'booking_logo',
  'booking_hero',
  'booking_gallery',
  'service_image',
  'favicon',
  'og_image',
] as const;

/**
 * İzin verilen içerik tipleri — beyaz liste.
 *
 * `image/svg+xml` YOK ve eklenmeyecek: kendi alan adımızdan servis edilen bir
 * SVG, script taşıyabildiği için saklı XSS'tir. Sanitizasyon Faz 9 kapsamı
 * değil ve yarım sanitize etmektense hiç kabul etmemek doğru.
 */
export const ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export class PresignAssetDto {
  @ApiProperty({ enum: ASSET_PURPOSES })
  @IsIn(ASSET_PURPOSES)
  purpose: TenantAssetPurpose;

  @ApiProperty({ enum: ASSET_MIME_TYPES })
  @IsIn(ASSET_MIME_TYPES)
  contentType: string;

  @ApiProperty({ minimum: 1, description: 'Bayt. Sunucu üst sınırı aşarsa reddeder.' })
  @IsInt()
  @Min(1)
  sizeBytes: number;
}

export class PresignAssetResponseDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty({ description: 'İstemcinin doğrudan PUT edeceği imzalı adres.' })
  uploadUrl: string;

  @ApiProperty()
  storageKey: string;

  @ApiProperty()
  expiresAt: string;
}

export class ConfirmAssetDto {
  @ApiProperty()
  @IsString()
  storageKey: string;

  @ApiProperty({ enum: ASSET_PURPOSES, description: 'Yönetim ekranındaki gruplama.' })
  @IsIn(ASSET_PURPOSES)
  purpose: TenantAssetPurpose;

  @ApiPropertyOptional({ maxLength: 200, description: 'Erişilebilirlik için alternatif metin.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @ApiPropertyOptional({ description: 'İstemcinin hesapladığı sha256 (opsiyonel bütünlük kaydı).' })
  @IsOptional()
  @Matches(/^[0-9a-f]{64}$/)
  sha256?: string;
}

export class AssetDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ASSET_PURPOSES })
  purpose: TenantAssetPurpose;

  @ApiProperty({
    description:
      'İmzasız ve DEĞİŞMEZ adres. Anahtar içerik hash’i taşır; görsel değişince URL değişir, bu yüzden bir yıl cache’lenebilir.',
  })
  url: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  sizeBytes: number;

  @ApiPropertyOptional({ nullable: true })
  width: number | null;

  @ApiPropertyOptional({ nullable: true })
  height: number | null;

  @ApiPropertyOptional({ nullable: true })
  altText: string | null;

  @ApiProperty({ enum: ['pending', 'ready'] })
  status: string;
}
