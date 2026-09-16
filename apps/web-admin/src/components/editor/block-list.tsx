'use client';

import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { ContentBlockInput } from '@klinara/shared';
import { canMove } from '@/lib/editor/move-block';
import { BLOCK_LABEL_KEY } from '@/lib/editor/block-schema';
import { BLOCK_ICON, blockSummary } from '@/lib/editor/block-meta';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Blok listesi ve sıralama.
 *
 * SÜRÜKLE-BIRAK KÜTÜPHANESİ YOK ve bu bilinçli bir karar. `dnd-kit` ~30 kB ve
 * klavye desteği için yine özel sensör + canlı bölge duyurusu yazmak gerekiyor;
 * yani erişilebilir kısmı zaten kendin yazıyorsun. O hâlde birincil mekanizma
 * doğrudan ERİŞİLEBİLİR olan olsun:
 *
 * - **Birincil: "Yukarı/Aşağı taşı" düğmeleri.** Klavye ve ekran okuyucu için
 *   yerel; hiçbir ARIA sürükleme deseni gerekmiyor. `aria-label` blok adını
 *   içeriyor, yani "Yukarı taşı" değil "Kapak bloğunu yukarı taşı".
 * - **İkincil: HTML5 `draggable`.** Fare kullanıcısı için kolaylık.
 *
 * İkisi de tek bir saf indirgeyiciye (`moveBlock`) akıyor.
 *
 * Taşımadan sonra ODAK taşınan satırın düğmesinde KALIYOR: odak listenin başına
 * dönseydi, bir bloğu üç sıra yukarı taşımak isteyen klavye kullanıcısı her
 * adımda yeniden sekmelemek zorunda kalırdı.
 *
 * Satır eylemleri fareyle yalnız üzerine gelince ya da seçili satırda görünür;
 * `opacity` ile gizlendikleri için DOM'da ve sekme sırasında kalırlar ve odak
 * geldiğinde (`focus-within`) görünür olurlar. Silme geri alınamaz bir eylem
 * olmadığı hâlde onay istiyor: yanlışlıkla silinen bir galeri, içindeki alt
 * metinlerle birlikte kaybolurdu.
 */
export function BlockList({
  sections,
  selected,
  readOnly,
  onSelect,
  onMove,
  onRemove,
  onToggleVisible,
}: {
  sections: readonly ContentBlockInput[];
  selected: number | null;
  readOnly: boolean;
  onSelect: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onToggleVisible: (index: number) => void;
}): ReactNode {
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());

  function move(from: number, direction: -1 | 1): void {
    const to = from + direction;
    const block = sections[from];
    if (block === undefined) return;

    onMove(from, to);
    setAnnouncement(
      t('editor.moved', { block: t(BLOCK_LABEL_KEY[block.type]), position: to + 1 }),
    );
    // Odağı taşınan satırın aynı düğmesine geri koy — liste yeniden
    // render edildiği için bir sonraki kareyi beklemek gerekiyor.
    requestAnimationFrame(() => buttonRefs.current.get(to)?.focus());
  }

  const removingBlock = removing === null ? undefined : sections[removing];

  return (
    <div>
      {/* Duyuru `polite`: sıralama kullanıcının kendi eylemi, sözünü kesmemeli. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {t('editor.noBlocks')}
        </p>
      ) : null}

      <ol className="flex flex-col gap-1.5">
        {sections.map((block, index) => {
          const label = t(BLOCK_LABEL_KEY[block.type]);
          const summary = blockSummary(block);
          const Icon = BLOCK_ICON[block.type];
          const hidden = block.visible === false;
          const isSelected = selected === index;
          return (
            <li
              key={index}
              draggable={!readOnly}
              onDragStart={() => setDragging(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragging !== null && dragging !== index) onMove(dragging, index);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
              className={cn(
                'group relative flex items-center gap-1 rounded-lg border py-1.5 pr-1.5 pl-1 transition-colors',
                isSelected
                  ? 'border-primary/60 bg-accent shadow-xs'
                  : 'border-border bg-card hover:border-primary/30 hover:bg-muted/40',
                dragging === index && 'opacity-50',
              )}
            >
              {readOnly ? null : (
                <GripVertical
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/60"
                />
              )}

              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={isSelected ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md',
                    isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    hidden && 'opacity-50',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className={cn('flex min-w-0 flex-col', hidden && 'opacity-60')}>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <span className="truncate">{label}</span>
                    {hidden ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground uppercase">
                        {t('editor.blockHidden')}
                      </span>
                    ) : null}
                  </span>
                  {summary !== null ? (
                    <span className="truncate text-xs text-muted-foreground">{summary}</span>
                  ) : null}
                </span>
              </button>

              {readOnly ? null : (
                <div
                  className={cn(
                    'flex shrink-0 items-center transition-opacity',
                    isSelected
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                  )}
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      ref={(node) => {
                        if (node === null) buttonRefs.current.delete(index);
                        else buttonRefs.current.set(index, node);
                      }}
                      onClick={() => move(index, -1)}
                      disabled={!canMove(sections.length, index, -1)}
                      aria-label={t('editor.moveUp', { block: label })}
                      className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={!canMove(sections.length, index, 1)}
                      aria-label={t('editor.moveDown', { block: label })}
                      className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleVisible(index)}
                    aria-label={`${label}: ${hidden ? 'göster' : 'gizle'}`}
                    aria-pressed={hidden}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    {hidden ? (
                      <EyeOff aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <Eye aria-hidden="true" className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(index)}
                    aria-label={t('editor.removeBlock', { block: label })}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <AlertDialog open={removingBlock !== undefined} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removingBlock === undefined
                ? ''
                : t('editor.removeTitle', { block: t(BLOCK_LABEL_KEY[removingBlock.type]) })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('editor.removeBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (removing !== null) onRemove(removing);
                setRemoving(null);
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
