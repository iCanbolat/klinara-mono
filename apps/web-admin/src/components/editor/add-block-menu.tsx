'use client';

import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { BLOCK_TYPES, type BlockType } from '@klinara/shared';
import { BLOCK_LABEL_KEY } from '@/lib/editor/block-schema';
import { BLOCK_HINT_KEY, BLOCK_ICON } from '@/lib/editor/block-meta';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * "Blok ekle" menüsü.
 *
 * Altı ayrı "+ Tür" düğmesi dar panelde üç satıra taşıyor ve türlerin ne işe
 * yaradığını söylemiyordu. Menü her türü simgesi ve bir cümlelik açıklamasıyla
 * listeliyor; Radix menüsü ok tuşu gezinmesini ve odak dönüşünü kendisi sağlıyor.
 */
export function AddBlockMenu({
  hasSelection,
  onAdd,
}: {
  hasSelection: boolean;
  onAdd: (type: BlockType) => void;
}): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="w-full justify-center gap-1.5 border-dashed">
          <Plus aria-hidden="true" className="size-4" />
          {t('editor.addBlock')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {hasSelection ? t('editor.addBlockAfter') : t('editor.addBlockEnd')}
        </DropdownMenuLabel>
        {BLOCK_TYPES.map((type) => {
          const Icon = BLOCK_ICON[type];
          return (
            <DropdownMenuItem key={type} onSelect={() => onAdd(type)} className="items-start gap-3 py-2">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{t(BLOCK_LABEL_KEY[type])}</span>
                <span className="text-xs text-muted-foreground">{t(BLOCK_HINT_KEY[type])}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
