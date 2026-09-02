/**
 * Randevu sayfası içerik sözlüğü — API ile web istemcilerinin TEK kaynağı.
 *
 * Neden burada: blok türleri, uzunluk sınırları ve tema beyaz listeleri iki
 * yerde yaşarsa editörün (11.5) ürettiği doküman bir gün API'nin DTO'sunu
 * geçemez ve hata ancak kullanıcı "Yayınla"ya bastığında görünür. Sunucu
 * dekoratörleri (`content.dto.ts`) ve istemci formları bu dosyadan besleniyor.
 *
 * ⚠️ Buraya class-validator/`@nestjs/swagger` GİRMEZ. `@klinara/shared` sıfır
 * runtime bağımlılığıyla duruyor; Next uygulamalarının `reflect-metadata`
 * çekmesi, tarayıcı bundle'ına sunucu doğrulama katmanını taşımak olurdu.
 * Doğrulama sunucuda dekoratörlerle, istemcide bu sabitlerle yapılır.
 */

/** İçerik dokümanı şema sürümü — `booking_page_revisions.schema_version`. */
export const CONTENT_SCHEMA_VERSION = 1;

export const BLOCK_TYPES = [
  'hero',
  'richText',
  'carousel',
  'serviceList',
  'contact',
  'map',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * Yazı tipi ve köşe yarıçapı SERBEST METİN DEĞİL, beyaz liste: serbest bir
 * `font-family` değeri sayfaya enjekte edilen bir CSS parçası olurdu.
 */
export const FONT_FAMILIES = ['system', 'inter', 'playfair', 'dm-sans', 'lora'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const RADII = ['none', 'sm', 'md', 'lg', 'full'] as const;
export type Radius = (typeof RADII)[number];

/** Her sınır tek yerde; dekoratörler ve istemci formları buradan okur. */
export const CONTENT_LIMITS = {
  sections: { max: 40 },
  hero: { title: 120, subtitle: 300, ctaLabel: 40 },
  richText: { title: 120, body: 8_000 },
  carousel: { title: 120, items: 20, alt: 200, caption: 120 },
  serviceList: { title: 120, categoryIds: 30 },
  contact: { title: 120 },
  map: { zoom: { min: 1, max: 20, default: 15 } },
  seo: { title: 70, description: 160 },
} as const;

// ---------------------------------------------------------------------------
// İki tip ailesi: YAZIM (admin) ve YAYIN (public)
//
// Sunucu public yanıtı üretirken `*AssetId` anahtarlarını çözülmüş görsel
// nesneleriyle DEĞİŞTİRİYOR (`present-public-site.ts`): `imageAssetId → image`,
// `logoAssetId → logo`, `ogImageAssetId → ogImage`, `assetId → image`. Bu
// dönüşüm tipte görünmezse istemci var olmayan bir `imageAssetId` alanını
// okumaya çalışır ve hata ancak çalışma zamanında ortaya çıkar.
// ---------------------------------------------------------------------------

export interface PublicImage {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

interface BlockBase<T extends BlockType> {
  type: T;
  /** Blok gizlenebilir — silmeden taslakta bekletmek için. Varsayılan `true`. */
  visible?: boolean;
}

// --- Yazım tarafı (admin editörü, PUT /booking-page/content) ---

export interface HeroBlockInput extends BlockBase<'hero'> {
  title: string;
  subtitle?: string;
  imageAssetId?: string;
  ctaLabel?: string;
}

export interface RichTextBlockInput extends BlockBase<'richText'> {
  title?: string;
  /** Markdown. HTML kabul edilmez — kendi alan adımızdan servis edilen XSS. */
  body: string;
}

export interface CarouselItemInput {
  assetId: string;
  alt?: string;
  caption?: string;
}

export interface CarouselBlockInput extends BlockBase<'carousel'> {
  title?: string;
  items: CarouselItemInput[];
}

export interface ServiceListBlockInput extends BlockBase<'serviceList'> {
  title?: string;
  /** Boş = online randevuya açık TÜM hizmetler. Yalnız süzgeç, yetki değil. */
  categoryIds?: string[];
}

export interface ContactBlockInput extends BlockBase<'contact'> {
  title?: string;
  showPhones?: boolean;
  showAddresses?: boolean;
}

export interface MapBlockInput extends BlockBase<'map'> {
  /** Boş = tüm şubeler. */
  branchId?: string;
  zoom?: number;
}

export type ContentBlockInput =
  | HeroBlockInput
  | RichTextBlockInput
  | CarouselBlockInput
  | ServiceListBlockInput
  | ContactBlockInput
  | MapBlockInput;

export interface ThemeInput {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: FontFamily;
  radius?: Radius;
  logoAssetId?: string;
}

export interface SeoInput {
  title?: string;
  description?: string;
  ogImageAssetId?: string;
}

export interface ContentDocumentInput {
  theme?: ThemeInput;
  sections: ContentBlockInput[];
  seo?: SeoInput;
}

// --- Yayın tarafı (GET /public/sites/:slug) ---

export type HeroBlock = Omit<HeroBlockInput, 'imageAssetId'> & { image?: PublicImage | null };
export type RichTextBlock = RichTextBlockInput;
export type CarouselItem = Omit<CarouselItemInput, 'assetId'> & { image?: PublicImage | null };
export type CarouselBlock = Omit<CarouselBlockInput, 'items'> & { items: CarouselItem[] };
export type ServiceListBlock = ServiceListBlockInput;
export type ContactBlock = ContactBlockInput;
export type MapBlock = MapBlockInput;

export type ContentBlock =
  | HeroBlock
  | RichTextBlock
  | CarouselBlock
  | ServiceListBlock
  | ContactBlock
  | MapBlock;

export type Theme = Omit<ThemeInput, 'logoAssetId'> & { logo?: PublicImage | null };
export type Seo = Omit<SeoInput, 'ogImageAssetId'> & { ogImage?: PublicImage | null };

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}
