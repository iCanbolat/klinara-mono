'use client';

import { MousePointerClick } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ContentBlockInput } from '@klinara/shared';
import { BLOCK_LABEL_KEY } from '@/lib/editor/block-schema';
import { BLOCK_HINT_KEY, BLOCK_ICON } from '@/lib/editor/block-meta';
import { t } from '@/i18n/tr';

/** Orta panelin başlığı: seçili bloğun simgesi, adı ve ne işe yaradığı. */
export function BlockFormHeader({ block }: { block: ContentBlockInput }): ReactNode {
  const Icon = BLOCK_ICON[block.type];
  return (
    <div className="flex items-start gap-3 border-b border-border pb-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold text-foreground">{t(BLOCK_LABEL_KEY[block.type])}</h2>
        <p className="text-xs text-muted-foreground">{t(BLOCK_HINT_KEY[block.type])}</p>
      </div>
    </div>
  );
}

/** Blok seçilmemişken orta panel — boş bir metin yerine ne yapılacağını söyler. */
export function EditorEmptyState(): ReactNode {
  return (
    <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MousePointerClick aria-hidden="true" className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{t('editor.emptyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('editor.emptyBody')}</p>
      </div>
    </div>
  );
}
