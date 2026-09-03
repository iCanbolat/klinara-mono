'use client';

import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { ContentBlockInput } from '@klinara/shared';
import { canMove } from '@/lib/editor/move-block';
import { BLOCK_LABEL_KEY } from '@/lib/editor/block-schema';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';

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

  return (
    <div>
      {/* Duyuru `polite`: sıralama kullanıcının kendi eylemi, sözünü kesmemeli. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <ol className="flex flex-col gap-1">
        {sections.map((block, index) => {
          const label = t(BLOCK_LABEL_KEY[block.type]);
          const hidden = block.visible === false;
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
                'flex items-center gap-1 rounded-md border px-2 py-1.5',
                selected === index ? 'border-brand bg-brand-soft' : 'border-line bg-card',
                dragging === index && 'opacity-50',
              )}
            >
              {readOnly ? null : (
                <GripVertical aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-soft" />
              )}

              <button
                type="button"
                onClick={() => onSelect(index)}
                className="min-w-0 flex-1 truncate text-left text-sm"
              >
                {label}
                {hidden ? (
                  <span className="ml-2 text-xs text-ink-soft">({t('editor.blockHidden')})</span>
                ) : null}
              </button>

              {readOnly ? null : (
                <>
                  <button
                    type="button"
                    ref={(node) => {
                      if (node === null) buttonRefs.current.delete(index);
                      else buttonRefs.current.set(index, node);
                    }}
                    onClick={() => move(index, -1)}
                    disabled={!canMove(sections.length, index, -1)}
                    aria-label={t('editor.moveUp', { block: label })}
                    className="rounded p-1 text-ink-soft hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronUp aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={!canMove(sections.length, index, 1)}
                    aria-label={t('editor.moveDown', { block: label })}
                    className="rounded p-1 text-ink-soft hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronDown aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleVisible(index)}
                    aria-label={`${label}: ${hidden ? 'göster' : 'gizle'}`}
                    aria-pressed={hidden}
                    className="rounded p-1 text-ink-soft hover:bg-muted"
                  >
                    {hidden ? (
                      <EyeOff aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <Eye aria-hidden="true" className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    aria-label={t('editor.removeBlock', { block: label })}
                    className="rounded p-1 text-ink-soft hover:bg-muted"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
