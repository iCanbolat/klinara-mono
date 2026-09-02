import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Blok sözlüğü v1.
 *
 * İçerik JSONB olarak saklanıyor ama gövde BURADAN geçmeden veritabanına
 * ulaşamıyor: `ValidationPipe` `whitelist: true` ile bilinmeyen alanları eler,
 * ayrımlı-birleşim (`discriminator`) ise sözlükte olmayan `type` değerini
 * REDDEDER. Sonuç: veritabanı asla renderer'ın çizemeyeceği bir blok tutmaz.
 *
 * Sözlüğü genişletmek bir migration değil, bu dosyaya bir sınıf eklemek —
 * tipli bir `booking_page_sections` tablosu yerine JSONB seçilmesinin sebebi
 * tam olarak bu.
 */
export const BLOCK_TYPES = [
  'hero',
  'richText',
  'carousel',
  'serviceList',
  'contact',
  'map',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

abstract class BaseBlockDto {
  @ApiProperty({ enum: BLOCK_TYPES })
  @IsIn(BLOCK_TYPES)
  type: BlockType;

  /** Blok gizlenebilir — silmeden taslakta bekletmek için. */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}

export class HeroBlockDto extends BaseBlockDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Arka plan görseli (`tenant_assets`).' })
  @IsOptional()
  @IsUUID()
  imageAssetId?: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Randevu butonunun metni.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ctaLabel?: string;
}

export class RichTextBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  /**
   * Markdown. HTML kabul EDİLMİYOR: kiracının kendi sayfasına keyfî işaretleme
   * koyabilmesi, kendi alan adımızdan servis edilen bir XSS yüzeyi demekti.
   */
  @ApiProperty({ maxLength: 8_000, description: 'Markdown (HTML değil).' })
  @IsString()
  @MaxLength(8_000)
  body: string;
}

export class CarouselItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  assetId: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Erişilebilirlik için alternatif metin.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  caption?: string;
}

export class CarouselBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty({ type: [CarouselItemDto], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CarouselItemDto)
  items: CarouselItemDto[];
}

export class ServiceListBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  /**
   * Gösterilecek kategoriler. Boş = online randevuya açık TÜM hizmetler.
   *
   * Kimlikler burada YALNIZCA bir süzgeçtir; hizmetin online alınabilir olup
   * olmadığına `services.is_online_bookable` karar verir. İçerik dokümanı bir
   * yetki kaynağı değildir.
   */
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];
}

export class ContactBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ default: true, description: 'Şube telefonları gösterilsin mi.' })
  @IsOptional()
  @IsBoolean()
  showPhones?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showAddresses?: boolean;
}

export class MapBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Boş = tüm şubeler.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  zoom?: number;
}

export type ContentBlockDto =
  | HeroBlockDto
  | RichTextBlockDto
  | CarouselBlockDto
  | ServiceListBlockDto
  | ContactBlockDto
  | MapBlockDto;

export class ThemeDto {
  @ApiPropertyOptional({ example: '#0F766E', description: 'Birincil marka rengi.' })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#F5F5F4' })
  @IsOptional()
  @IsHexColor()
  backgroundColor?: string;

  @ApiPropertyOptional({ example: '#1C1917' })
  @IsOptional()
  @IsHexColor()
  textColor?: string;

  /**
   * Yazı tipi ailesi — SERBEST METİN DEĞİL, beyaz liste.
   *
   * Serbest bırakılsaydı `font-family` değeri sayfaya enjekte edilen bir CSS
   * parçası olurdu.
   */
  @ApiPropertyOptional({ enum: ['system', 'inter', 'playfair', 'dm-sans', 'lora'] })
  @IsOptional()
  @IsIn(['system', 'inter', 'playfair', 'dm-sans', 'lora'])
  fontFamily?: string;

  @ApiPropertyOptional({ enum: ['none', 'sm', 'md', 'lg', 'full'] })
  @IsOptional()
  @IsIn(['none', 'sm', 'md', 'lg', 'full'])
  radius?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  logoAssetId?: string;
}

export class SeoDto {
  @ApiPropertyOptional({ maxLength: 70 })
  @IsOptional()
  @IsString()
  @MaxLength(70)
  title?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ogImageAssetId?: string;
}

@ApiExtraModels(
  HeroBlockDto,
  RichTextBlockDto,
  CarouselBlockDto,
  ServiceListBlockDto,
  ContactBlockDto,
  MapBlockDto,
)
export class UpdateBookingPageContentDto {
  @ApiPropertyOptional({ type: ThemeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ThemeDto)
  theme?: ThemeDto;

  @ApiProperty({
    isArray: true,
    maxItems: 40,
    oneOf: [
      { $ref: getSchemaPath(HeroBlockDto) },
      { $ref: getSchemaPath(RichTextBlockDto) },
      { $ref: getSchemaPath(CarouselBlockDto) },
      { $ref: getSchemaPath(ServiceListBlockDto) },
      { $ref: getSchemaPath(ContactBlockDto) },
      { $ref: getSchemaPath(MapBlockDto) },
    ],
  })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => BaseBlockDto, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'type',
      subTypes: [
        { value: HeroBlockDto, name: 'hero' },
        { value: RichTextBlockDto, name: 'richText' },
        { value: CarouselBlockDto, name: 'carousel' },
        { value: ServiceListBlockDto, name: 'serviceList' },
        { value: ContactBlockDto, name: 'contact' },
        { value: MapBlockDto, name: 'map' },
      ],
    },
  })
  sections: ContentBlockDto[];

  @ApiPropertyOptional({ type: SeoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SeoDto)
  seo?: SeoDto;
}

export class RevisionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 42 })
  revisionNumber: number;

  @ApiProperty({ example: '9f3c1a2b…' })
  contentHash: string;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: 'Bu sürüm şu anda yayında mı.' })
  isPublished: boolean;
}

export class BookingPageContentDto {
  @ApiPropertyOptional({ type: RevisionSummaryDto, nullable: true })
  draft: RevisionSummaryDto | null;

  @ApiPropertyOptional({ type: RevisionSummaryDto, nullable: true })
  published: RevisionSummaryDto | null;

  @ApiProperty({ type: ThemeDto })
  theme: Record<string, unknown>;

  @ApiProperty({ isArray: true, type: Object })
  sections: unknown[];

  @ApiProperty({ type: SeoDto })
  seo: Record<string, unknown>;
}
