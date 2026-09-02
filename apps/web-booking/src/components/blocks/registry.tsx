import type { ReactElement } from 'react';
import type { BlockType, ContentBlock } from '@klinara/shared';
import { isBlockType } from '@klinara/shared';
import {
  Carousel,
  Contact,
  Hero,
  MapBlockView,
  RichText,
  ServiceList,
  type BlockContext,
} from './blocks';

/**
 * Blok türü → bileşen.
 *
 * ⚠️ SÖZLÜKTE OLMAYAN TÜR SESSİZCE ATLANIR. Bu bir hata yutma değil, açık bir
 * uyumluluk kararı: API sözlüğü büyüttüğünde (referans, SSS, öncesi/sonrası)
 * yeni blok yayınlanır ama henüz dağıtılmamış istemci onu tanımaz. Alternatif
 * beyaz ekrandı — kliniğin sayfası, bizim dağıtım takvimimiz yüzünden çöker.
 * Üretimde konsola da yazılmıyor: sayfa her render'da gürültü üretmemeli.
 */
const REGISTRY: Record<BlockType, (props: { block: never; ctx: BlockContext }) => ReactElement | null> = {
  hero: Hero as never,
  richText: RichText as never,
  carousel: Carousel as never,
  serviceList: ServiceList as never,
  contact: Contact as never,
  map: MapBlockView as never,
};

/** Render edilecek blokları süz — gizliler ve tanınmayanlar düşer. */
export function renderableBlocks(sections: unknown): ContentBlock[] {
  if (!Array.isArray(sections)) return [];
  return sections.filter((section): section is ContentBlock => {
    if (typeof section !== 'object' || section === null) return false;
    const candidate = section as { type?: unknown; visible?: unknown };
    if (candidate.visible === false) return false;
    return isBlockType(candidate.type);
  });
}

export function RenderBlocks({ sections, ctx }: { sections: unknown; ctx: Omit<BlockContext, 'isFirst'> }) {
  const blocks = renderableBlocks(sections);
  return (
    <>
      {blocks.map((block, index) => {
        const Component = REGISTRY[block.type];
        if (Component === undefined) return null;
        return (
          <Component key={index} block={block as never} ctx={{ ...ctx, isFirst: index === 0 }} />
        );
      })}
    </>
  );
}

export { REGISTRY as BLOCK_REGISTRY };
