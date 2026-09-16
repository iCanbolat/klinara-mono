'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { CONTENT_LIMITS, type FaqItemInput } from '@klinara/shared';
import { moveItem } from '@/lib/editor/move-block';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';

const LIMITS = CONTENT_LIMITS.faq;

/**
 * SSS öge editörü — soru ve cevap çiftleri.
 *
 * Karusel öge editörüyle aynı erişilebilirlik deseni: sıralama "Yukarı/Aşağı
 * taşı" düğmeleriyle (etikette SIRA NUMARASI), taşıma `role="status"` ile
 * duyuruluyor ve odak taşınan ögede kalıyor. Yeni soru eklenince odak onun
 * soru alanına gidiyor; kullanıcı fareye dönmeden yazmaya başlayabilsin.
 */
export function FaqItems({
  items,
  label,
  readOnly,
  error,
  onChange,
}: {
  items: readonly FaqItemInput[];
  label: string;
  readOnly: boolean;
  error: string | undefined;
  onChange: (items: FaqItemInput[]) => void;
}): ReactNode {
  const [announcement, setAnnouncement] = useState('');
  const moveRefs = useRef(new Map<number, HTMLButtonElement>());
  const questionRefs = useRef(new Map<number, HTMLInputElement>());
  const full = items.length >= LIMITS.items;

  function patch(index: number, next: Partial<FaqItemInput>): void {
    onChange(items.map((item, position) => (position === index ? { ...item, ...next } : item)));
  }

  function move(from: number, direction: -1 | 1): void {
    const to = from + direction;
    if (to < 0 || to >= items.length) return;
    onChange(moveItem(items, from, to));
    setAnnouncement(t('faq.item', { position: to + 1 }));
    requestAnimationFrame(() => moveRefs.current.get(to)?.focus());
  }

  function add(): void {
    const index = items.length;
    onChange([...items, { question: '', answer: '' }]);
    requestAnimationFrame(() => questionRefs.current.get(index)?.focus());
  }

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium text-foreground">
        <span>{label}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {items.length}/{LIMITS.items}
        </span>
      </legend>

      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
          {t('faq.empty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => {
            const position = index + 1;
            return (
              <li key={index} className="flex gap-2 rounded-lg border border-border bg-card p-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t('faq.item', { position })}
                  </span>
                  <label className="flex flex-col gap-0.5">
                    <span className="sr-only">{t('faq.question')}</span>
                    <input
                      ref={(node) => {
                        if (node === null) questionRefs.current.delete(index);
                        else questionRefs.current.set(index, node);
                      }}
                      value={item.question}
                      placeholder={t('faq.question')}
                      onChange={(event) => patch(index, { question: event.target.value })}
                      maxLength={LIMITS.question}
                      readOnly={readOnly}
                      aria-invalid={item.question.trim() === ''}
                      className="h-9 rounded-md border border-border bg-background px-2 text-sm font-medium aria-invalid:border-destructive/60"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="sr-only">{t('faq.answer')}</span>
                    <textarea
                      value={item.answer}
                      placeholder={t('faq.answer')}
                      onChange={(event) => patch(index, { answer: event.target.value })}
                      maxLength={LIMITS.answer}
                      readOnly={readOnly}
                      rows={3}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>

                {readOnly ? null : (
                  <div className="flex shrink-0 flex-col items-center gap-0.5">
                    <button
                      type="button"
                      ref={(node) => {
                        if (node === null) moveRefs.current.delete(index);
                        else moveRefs.current.set(index, node);
                      }}
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t('faq.moveUp', { position })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === items.length - 1}
                      aria-label={t('faq.moveDown', { position })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(items.filter((_, other) => other !== index))}
                      aria-label={t('faq.remove', { position })}
                      className="mt-auto rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {readOnly ? null : (
        <>
          <Button type="button" variant="secondary" size="sm" className="border-dashed" disabled={full} onClick={add}>
            <Plus aria-hidden="true" className="size-4" />
            {t('faq.add')}
          </Button>
          {full ? <p className="text-xs text-muted-foreground">{t('faq.full', { max: LIMITS.items })}</p> : null}
        </>
      )}

      {error !== undefined ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
