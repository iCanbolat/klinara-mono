import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import {
  BLOCK_TYPES,
  CONTENT_LIMITS,
  FONT_FAMILIES,
  RADII,
  type BlockType,
  type FontFamily,
  type Radius,
} from '@klinara/shared';
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
 * Blok sözlüğü v1 — DOĞRULAMA katmanı.
 *
 * Sözlüğün kendisi (`BLOCK_TYPES`, uzunluk sınırları, tema beyaz listeleri)
 * `@klinara/shared`'te duruyor; burada yalnız o sabitlerin class-validator
 * karşılığı var. İkiye bölünmesinin sebebi web istemcisi: aynı sınırları
 * editör formunun da bilmesi gerekiyor ve Next'in `class-validator` çekmesi
 * gerekmiyor.
 *
 * İçerik JSONB olarak saklanıyor ama gövde BURADAN geçmeden veritabanına
 * ulaşamıyor: `ValidationPipe` `whitelist: true` ile bilinmeyen alanları eler,
 * ayrımlı-birleşim (`discriminator`) ise sözlükte olmayan `type` değerini
 * REDDEDER. Sonuç: veritabanı asla renderer'ın çizemeyeceği bir blok tutmaz.
 *
 * Sözlüğü genişletmek bir migration değil, shared'a bir tip + buraya bir sınıf
 * eklemek — tipli bir `booking_page_sections` tablosu yerine JSONB seçilmesinin
 * sebebi tam olarak bu.
 */
export { BLOCK_TYPES, type BlockType };

/** Blok başlıklarının ortak üst sınırı — sözlükte hepsi aynı değeri taşıyor. */
const BLOCK_TITLE_MAX = CONTENT_LIMITS.richText.title;

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
  @ApiProperty({ maxLength: CONTENT_LIMITS.hero.title })
  @IsString()
  @MaxLength(CONTENT_LIMITS.hero.title)
  title: string;

  @ApiPropertyOptional({ maxLength: CONTENT_LIMITS.hero.subtitle })
  @IsOptional()
  @IsString()
  @MaxLength(CONTENT_LIMITS.hero.subtitle)
  subtitle?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Arka plan görseli (`tenant_assets`).' })
  @IsOptional()
  @IsUUID()
  imageAssetId?: string;

  @ApiPropertyOptional({ maxLength: CONTENT_LIMITS.hero.ctaLabel, description: 'Randevu butonunun metni.' })
  @IsOptional()
  @IsString()
  @MaxLength(CONTENT_LIMITS.hero.ctaLabel)
  ctaLabel?: string;
}

export class RichTextBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: BLOCK_TITLE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(BLOCK_TITLE_MAX)
  title?: string;

  /**
   * Markdown. HTML kabul EDİLMİYOR: kiracının kendi sayfasına keyfî işaretleme
   * koyabilmesi, kendi alan adımızdan servis edilen bir XSS yüzeyi demekti.
   */
  @ApiProperty({ maxLength: CONTENT_LIMITS.richText.body, description: 'Markdown (HTML değil).' })
  @IsString()
  @MaxLength(CONTENT_LIMITS.richText.body)
  body: string;
}

export class CarouselItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  assetId: string;

  @ApiPropertyOptional({
    maxLength: CONTENT_LIMITS.carousel.alt,
    description: 'Erişilebilirlik için alternatif metin.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CONTENT_LIMITS.carousel.alt)
  alt?: string;

  @ApiPropertyOptional({ maxLength: CONTENT_LIMITS.carousel.caption })
  @IsOptional()
  @IsString()
  @MaxLength(CONTENT_LIMITS.carousel.caption)
  caption?: string;
}

export class CarouselBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: BLOCK_TITLE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(BLOCK_TITLE_MAX)
  title?: string;

  @ApiProperty({ type: [CarouselItemDto], maxItems: CONTENT_LIMITS.carousel.items })
  @IsArray()
  @ArrayMaxSize(CONTENT_LIMITS.carousel.items)
  @ValidateNested({ each: true })
  @Type(() => CarouselItemDto)
  items: CarouselItemDto[];
}

export class ServiceListBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: BLOCK_TITLE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(BLOCK_TITLE_MAX)
  title?: string;

  /**
   * Gösterilecek kategoriler. Boş = online randevuya açık TÜM hizmetler.
   *
   * Kimlikler burada YALNIZCA bir süzgeçtir; hizmetin online alınabilir olup
   * olmadığına `services.is_online_bookable` karar verir. İçerik dokümanı bir
   * yetki kaynağı değildir.
   */
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: CONTENT_LIMITS.serviceList.categoryIds })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONTENT_LIMITS.serviceList.categoryIds)
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];
}

export class ContactBlockDto extends BaseBlockDto {
  @ApiPropertyOptional({ maxLength: BLOCK_TITLE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(BLOCK_TITLE_MAX)
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

  @ApiPropertyOptional({
    minimum: CONTENT_LIMITS.map.zoom.min,
    maximum: CONTENT_LIMITS.map.zoom.max,
    default: CONTENT_LIMITS.map.zoom.default,
  })
  @IsOptional()
  @IsInt()
  @Min(CONTENT_LIMITS.map.zoom.min)
  @Max(CONTENT_LIMITS.map.zoom.max)
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
  @ApiPropertyOptional({ enum: FONT_FAMILIES })
  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: FontFamily;

  @ApiPropertyOptional({ enum: RADII })
  @IsOptional()
  @IsIn(RADII)
  radius?: Radius;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  logoAssetId?: string;
}

export class SeoDto {
  @ApiPropertyOptional({ maxLength: CONTENT_LIMITS.seo.title })
  @IsOptional()
  @IsString()
  @MaxLength(CONTENT_LIMITS.seo.title)
  title?: string;

  @ApiPropertyOptional({ maxLength: CONTENT_LIMITS.seo.description })
  @IsOptional()
  @IsString()
  @MaxLength(CONTENT_LIMITS.seo.description)
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
    maxItems: CONTENT_LIMITS.sections.max,
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
  @ArrayMaxSize(CONTENT_LIMITS.sections.max)
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
