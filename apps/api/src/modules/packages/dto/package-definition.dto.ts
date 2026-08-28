import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Query string'de boolean YOKTUR, metin vardır.
 *
 * `@Type(() => Boolean)` burada işe yaramaz: `Boolean('false')` da `true`
 * döner, yani `?isActive=false` filtresi sessizce tersine çalışırdı.
 */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class PackageDefinitionItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ minimum: 1, maximum: 1000, example: 10 })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class CreatePackageDefinitionDto {
  @ApiProperty({ example: 'lazer-10-seans', description: 'Kiracı içinde tekil' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i, {
    message: 'slug yalnız harf, rakam ve tire içerebilir',
  })
  slug: string;

  @ApiProperty({ example: '10 Seans Lazer + 2 Bakım' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    example: 2400000,
    description: 'Paketin SATIŞ fiyatı (kuruş). Kalemlerin liste toplamından farklı olabilir.',
  })
  @IsInt()
  @Min(0)
  totalPriceMinor: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Verilmezse paket tüm şubelerde satılır ve kullanılır.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 3650,
    description: 'Satıştan itibaren geçerlilik. Verilmezse paket süresizdir.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  validityDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isTransferable?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOnlineSellable?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [PackageDefinitionItemInputDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PackageDefinitionItemInputDto)
  items: PackageDefinitionItemInputDto[];
}

export class UpdatePackageDefinitionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  totalPriceMinor?: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  validityDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isTransferable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnlineSellable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [PackageDefinitionItemInputDto],
    description: 'Verilirse kalem listesi TAMAMEN bununla değiştirilir.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PackageDefinitionItemInputDto)
  items?: PackageDefinitionItemInputDto[];
}

export class ListPackageDefinitionsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Önceki sayfanın `pageInfo.nextCursor` değeri' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Bu şubede satılabilen paketler' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Bu hizmeti içeren paketler' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class PackageDefinitionItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  serviceId: string;

  @ApiProperty()
  serviceName: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ description: 'Satış anındaki katalog birim fiyatı (kuruş)' })
  unitListPriceMinor: number;

  @ApiProperty()
  sortOrder: number;
}

export class PackageDefinitionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  branchId: string | null;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty()
  totalPriceMinor: number;

  @ApiProperty({
    description: 'Kalemlerin güncel katalog fiyatları toplamı — indirim buradan okunur.',
  })
  listPriceMinor: number;

  @ApiProperty({ example: 'TRY' })
  currency: string;

  @ApiProperty({ nullable: true, type: Number })
  validityDays: number | null;

  @ApiProperty()
  isTransferable: boolean;

  @ApiProperty()
  isOnlineSellable: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'Satışı etkileyen alanlar değiştikçe artar' })
  revision: number;

  @ApiProperty({ description: 'Optimistic locking sayacı (ETag)' })
  version: number;

  @ApiProperty({ type: [PackageDefinitionItemResponseDto] })
  items: PackageDefinitionItemResponseDto[];

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiProperty({ nullable: true, type: String })
  deletedAt: string | null;
}

export class PackageDefinitionPageDto {
  @ApiProperty({ type: [PackageDefinitionResponseDto] })
  data: PackageDefinitionResponseDto[];

  @ApiProperty()
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}
