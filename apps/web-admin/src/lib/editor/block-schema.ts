import {
  BLOCK_TYPES,
  CONTENT_LIMITS,
  FONT_FAMILIES,
  RADII,
  type BlockType,
  type ContentBlockInput,
} from '@klinara/shared';
import type { MessageKey } from '@/i18n/tr';

/**
 * Blok türü → form alanları. Sözlükten TÜRETİLİYOR, elle yazılmıyor.
 *
 * Her `max` `CONTENT_LIMITS`ten, her `select` `FONT_FAMILIES`/`RADII`den
 * okunuyor. Sınırları forma elle kopyalamak, sunucu sınırı değiştiğinde
 * kullanıcının 8000 karakter yazıp "Kaydet"e bastıktan SONRA hata görmesi
 * demekti; `block-schema.test.ts` iki temsilin eşitliğini iddia ediyor.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'asset'
  | 'assetList'
  | 'uuidList'
  | 'boolean'
  | 'number'
  | 'branch';

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  /** Doğrudan gösterilen etiket. Blok ADLARI sözlükten (`BLOCK_LABEL_KEY`). */
  labelKey: string;
  max?: number;
  min?: number;
  maxItems?: number;
  /** Boş bırakılabilir mi. */
  required?: boolean;
}

export const BLOCK_FIELDS: Record<BlockType, readonly FieldSpec[]> = {
  hero: [
    { key: 'title', kind: 'text', labelKey: 'Başlık', max: CONTENT_LIMITS.hero.title, required: true },
    { key: 'subtitle', kind: 'text', labelKey: 'Alt başlık', max: CONTENT_LIMITS.hero.subtitle },
    { key: 'imageAssetId', kind: 'asset', labelKey: 'Arka plan görseli' },
    { key: 'ctaLabel', kind: 'text', labelKey: 'Buton metni', max: CONTENT_LIMITS.hero.ctaLabel },
  ],
  richText: [
    { key: 'title', kind: 'text', labelKey: 'Başlık', max: CONTENT_LIMITS.richText.title },
    {
      key: 'body',
      kind: 'markdown',
      labelKey: 'Metin (Markdown)',
      max: CONTENT_LIMITS.richText.body,
      required: true,
    },
  ],
  carousel: [
    { key: 'title', kind: 'text', labelKey: 'Başlık', max: CONTENT_LIMITS.carousel.title },
    {
      key: 'items',
      kind: 'assetList',
      labelKey: 'Görseller',
      maxItems: CONTENT_LIMITS.carousel.items,
    },
  ],
  serviceList: [
    { key: 'title', kind: 'text', labelKey: 'Başlık', max: CONTENT_LIMITS.serviceList.title },
    {
      key: 'categoryIds',
      kind: 'uuidList',
      labelKey: 'Kategoriler (boş = tümü)',
      maxItems: CONTENT_LIMITS.serviceList.categoryIds,
    },
  ],
  contact: [
    { key: 'title', kind: 'text', labelKey: 'Başlık', max: CONTENT_LIMITS.contact.title },
    { key: 'showPhones', kind: 'boolean', labelKey: 'Telefonları göster' },
    { key: 'showAddresses', kind: 'boolean', labelKey: 'Adresleri göster' },
  ],
  map: [
    { key: 'branchId', kind: 'branch', labelKey: 'Şube (boş = tümü)' },
    {
      key: 'zoom',
      kind: 'number',
      labelKey: 'Yakınlaştırma',
      min: CONTENT_LIMITS.map.zoom.min,
      max: CONTENT_LIMITS.map.zoom.max,
    },
  ],
};

/** Blok türlerinin kullanıcıya gösterilen adı. */
export const BLOCK_LABEL_KEY: Record<BlockType, MessageKey> = {
  hero: 'block.hero',
  richText: 'block.richText',
  carousel: 'block.carousel',
  serviceList: 'block.serviceList',
  contact: 'block.contact',
  map: 'block.map',
};

/** Yeni blok — zorunlu alanları boş ama GEÇERLİ bir iskeletle. */
export function emptyBlock(type: BlockType): ContentBlockInput {
  switch (type) {
    case 'hero':
      return { type, title: '' };
    case 'richText':
      return { type, body: '' };
    case 'carousel':
      return { type, items: [] };
    case 'serviceList':
      return { type };
    case 'contact':
      return { type };
    case 'map':
      return { type, zoom: CONTENT_LIMITS.map.zoom.default };
  }
}

export const THEME_FONT_OPTIONS = FONT_FAMILIES;
export const THEME_RADIUS_OPTIONS = RADII;
export const ALL_BLOCK_TYPES = BLOCK_TYPES;
