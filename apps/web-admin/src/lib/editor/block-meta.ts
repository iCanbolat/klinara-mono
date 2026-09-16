import {
  AlignLeft,
  Contact,
  GalleryHorizontal,
  MessageCircleQuestion,
  ListChecks,
  MapPin,
  PanelTop,
  type LucideIcon,
} from 'lucide-react';
import type { BlockType, ContentBlockInput } from '@klinara/shared';
import type { MessageKey } from '@/i18n/tr';

/** Blok türünün listede ve ekleme menüsünde görünen simgesi ve kısa açıklaması. */
export const BLOCK_ICON: Record<BlockType, LucideIcon> = {
  hero: PanelTop,
  richText: AlignLeft,
  carousel: GalleryHorizontal,
  serviceList: ListChecks,
  contact: Contact,
  map: MapPin,
  faq: MessageCircleQuestion,
};

export const BLOCK_HINT_KEY: Record<BlockType, MessageKey> = {
  hero: 'editor.blockHint.hero',
  richText: 'editor.blockHint.richText',
  carousel: 'editor.blockHint.carousel',
  serviceList: 'editor.blockHint.serviceList',
  contact: 'editor.blockHint.contact',
  map: 'editor.blockHint.map',
  faq: 'editor.blockHint.faq',
};

/**
 * Listede tür adının altında gösterilen tek satırlık özet.
 *
 * Aynı türden iki blok (ör. "Hakkımızda" ve "SSS" metinleri) yalnız tür
 * adıyla ayırt edilemiyordu; başlık varsa o, yoksa içeriğin ilk anlamlı parçası.
 */
export function blockSummary(block: ContentBlockInput): string | null {
  switch (block.type) {
    case 'hero':
      return nonEmpty(block.title);
    case 'richText':
      return nonEmpty(block.title) ?? nonEmpty(firstLine(block.body));
    case 'carousel': {
      const count = block.items.length;
      const title = nonEmpty(block.title);
      const images = count === 0 ? 'görsel yok' : `${String(count)} görsel`;
      return title === null ? images : `${title} · ${images}`;
    }
    case 'serviceList':
    case 'contact':
      return nonEmpty(block.title);
    case 'map':
      return null;
    case 'faq': {
      const count = block.items.length;
      const questions = `${String(count)} soru`;
      const title = nonEmpty(block.title);
      return title === null ? questions : `${title} · ${questions}`;
    }
  }
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Markdown işaretlerini atılmış ilk dolu satır. */
function firstLine(markdown: string): string {
  const line = markdown.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.replace(/[*_#>`[\]]/g, '').replace(/\(.*?\)/g, '').trim();
}
