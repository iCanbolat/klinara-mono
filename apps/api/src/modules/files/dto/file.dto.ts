import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  CustomerFileKind,
  CustomerFilePosition,
} from '../../../database/schema/files';

export const FILE_KINDS = ['photo', 'document'] as const;
export const FILE_POSITIONS = ['before', 'after', 'other'] as const;

/**
 * İndirme adresinin hangi nesneyi işaret ettiği.
 *
 * `thumb` yalnız fotoğraflarda ve küçük görsel üretildikten SONRA anlamlı;
 * hazır değilken sessizce tam boyuta düşmek 25 MB'lık bir nesneyi ızgaraya
 * indirmek olurdu.
 */
export const FILE_VARIANTS = ['original', 'thumb'] as const;
export type FileVariant = (typeof FILE_VARIANTS)[number];

/**
 * İzin verilen içerik tipleri.
 *
 * Beyaz liste, kara liste değil: yarın eklenecek bir tipin sessizce geçmesi
 * yerine açıkça eklenmesi gerekiyor. `image/svg+xml` bilinçli olarak YOK —
 * SVG çalıştırılabilir içerik taşır.
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

export class PresignUploadDto {
  @ApiProperty({ format: 'uuid', description: 'Dosyanın bağlanacağı müşteri.' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ enum: ALLOWED_MIME_TYPES })
  @IsIn(ALLOWED_MIME_TYPES)
  contentType: string;

  @ApiProperty({ minimum: 1, description: 'Bayt. Sunucu üst sınırı aşarsa reddeder.' })
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @ApiProperty({ enum: FILE_KINDS })
  @IsIn(FILE_KINDS)
  kind: CustomerFileKind;
}

export class PresignUploadResponseDto {
  @ApiProperty({ description: 'Yüklemeden sonra `confirm` adımına verilecek anahtar.' })
  storageKey: string;

  @ApiProperty({ description: 'İstemci bu adrese doğrudan PUT eder.' })
  uploadUrl: string;

  @ApiProperty({ description: 'PUT isteğinde AYNEN gönderilmesi gereken Content-Type.' })
  contentType: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

export class ConfirmFileDto {
  @ApiProperty({ description: '`presign` adımından dönen anahtar.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  storageKey: string;

  @ApiProperty({ enum: FILE_KINDS })
  @IsIn(FILE_KINDS)
  kind: CustomerFileKind;

  @ApiPropertyOptional({ enum: FILE_POSITIONS, default: 'other' })
  @IsOptional()
  @IsIn(FILE_POSITIONS)
  position?: CustomerFilePosition;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({
    description: 'İçeriğin sha256 özeti (hex). Verilirse sunucu boyutla birlikte doğrular.',
  })
  @IsOptional()
  @Matches(/^[0-9a-f]{64}$/, { message: 'sha256 64 karakterlik hex olmalı' })
  sha256?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Fotoğrafın çekildiği an.' })
  @IsOptional()
  @IsDateString()
  takenAt?: string;
}

export class CustomerFileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  groupId: string | null;

  @ApiProperty({ enum: FILE_KINDS })
  kind: CustomerFileKind;

  @ApiProperty({ enum: FILE_POSITIONS })
  position: CustomerFilePosition;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  sizeBytes: number;

  @ApiProperty({ nullable: true, type: String })
  sha256: string | null;

  @ApiProperty({ description: 'Küçük görsel hazır mı — kuyruk işi tamamlanınca dolar.' })
  hasThumbnail: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  takenAt: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  uploadedBy: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class CustomerFileListResponseDto {
  @ApiProperty({ type: [CustomerFileResponseDto] })
  data: CustomerFileResponseDto[];
}

export class DownloadUrlQueryDto {
  @ApiPropertyOptional({ enum: FILE_VARIANTS, default: 'original' })
  @IsOptional()
  @IsIn(FILE_VARIANTS)
  variant?: FileVariant;
}

export class DownloadUrlResponseDto {
  @ApiProperty()
  url: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

export class FileGroupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, type: String })
  bodyArea: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  serviceId: string | null;

  @ApiProperty({ type: [CustomerFileResponseDto] })
  files: CustomerFileResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class FileGroupListResponseDto {
  @ApiProperty({ type: [FileGroupResponseDto] })
  data: FileGroupResponseDto[];
}

export class CreateFileGroupDto {
  @ApiProperty({ example: 'Sağ kol — 3. seans' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'sağ kol' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bodyArea?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}
