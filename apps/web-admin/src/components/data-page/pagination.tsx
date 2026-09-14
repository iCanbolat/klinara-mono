'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';

/**
 * Liste sayfalaması — iki biçim.
 *
 * - `ClientPagination`: tüm liste elde; numaralı sayfalar ve "x–y / toplam".
 *   Telefonda numaralar gizlenip yalnız "Sayfa n / m" kalıyor.
 * - `CursorPagination`: sunucu cursor'lı, TOPLAM BİLİNMİYOR. Numara ya da
 *   "son sayfa" uydurulmuyor; yalnız Önceki / Sonraki.
 *
 * Tek sayfa varsa hiçbiri render edilmiyor — tıklanamayan iki gri düğme gürültü.
 */

export function ClientPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  /** 1 tabanlı. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}): ReactNode {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label={t('list.pagination')}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        {t('list.range', { from, to, total })}
      </p>
      <div className="flex items-center gap-1">
        <PrevButton disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
        <span className="px-2 text-sm tabular-nums sm:hidden">
          {t('list.pageOf', { n: page, total: pageCount })}
        </span>
        <ol className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, pageCount).map((item, index) =>
            item === null ? (
              <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
                …
              </li>
            ) : (
              <li key={item}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={item === page ? 'primary' : 'ghost'}
                  aria-label={t('list.goToPage', { n: item })}
                  aria-current={item === page ? 'page' : undefined}
                  className="tabular-nums"
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </Button>
              </li>
            ),
          )}
        </ol>
        <NextButton disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} />
      </div>
    </nav>
  );
}

export function CursorPagination({
  pageIndex,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  disabled = false,
}: {
  /** 0 tabanlı. */
  pageIndex: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Sayfa yüklenirken çift tıklamayla iki sayfa atlanmasın. */
  disabled?: boolean;
}): ReactNode {
  if (!hasPrev && !hasNext) return null;

  return (
    <nav
      aria-label={t('list.pagination')}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {t('list.page', { n: pageIndex + 1 })}
      </p>
      <div className="flex items-center gap-1">
        <PrevButton disabled={disabled || !hasPrev} onClick={onPrev} />
        <NextButton disabled={disabled || !hasNext} onClick={onNext} />
      </div>
    </nav>
  );
}

function PrevButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }): ReactNode {
  return (
    <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onClick}>
      <ChevronLeft aria-hidden="true" />
      <span className="max-sm:sr-only">{t('list.prev')}</span>
    </Button>
  );
}

function NextButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }): ReactNode {
  return (
    <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onClick}>
      <span className="max-sm:sr-only">{t('list.next')}</span>
      <ChevronRight aria-hidden="true" />
    </Button>
  );
}

/**
 * Gösterilecek sayfa numaraları: ilk, son, geçerli ±1; aradaki boşluklar
 * `null` (üç nokta). Ör. 10 sayfada 5 → `[1, null, 4, 5, 6, null, 10]`.
 */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (const n of sorted) {
    const last = result.at(-1);
    if (typeof last === 'number' && n - last > 1) {
      // Tek bir sayfalık boşluğu üç noktayla değil numarasıyla doldur.
      if (n - last === 2) result.push(last + 1);
      else result.push(null);
    }
    result.push(n);
  }
  return result;
}
