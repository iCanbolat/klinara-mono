'use client';

import { useState, type ReactNode } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentButton, Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { ClientPagination, CursorPagination } from './pagination';
import { useViewMode } from './use-view-mode';

/**
 * Liste sayfası iskeleti — müşteriler, hizmetler, personel.
 *
 * Başlık + CTA, süzgeç slotu, tablo/kart geçişi, yükleniyor/hata/boş
 * durumları ve sayfalama burada. VERİ, SÜZME ve SATIR GÖRÜNÜMÜ sayfanın:
 * DataPage ne getirir ne süzer; `renderTable` ve `renderCard` ile sayfanın
 * kendi bileşenlerini çizer.
 *
 * ---------------------------------------------------------------------------
 * SAYFALAMA: CLIENT MI SERVER MI
 * ---------------------------------------------------------------------------
 * - `client`: `rows` SÜZÜLMÜŞ TAM liste; dilimleme burada. Süzgeç değişince
 *   `resetKey` değişmeli, yoksa kullanıcı 4. sayfada kalıp boş ekran görür.
 * - `server`: `rows` yalnız o sayfa; gezinme sayfanın hook'unda (cursor).
 *   Toplam bilinmediği için numara gösterilmiyor — bkz. `pagination.tsx`.
 *
 * ---------------------------------------------------------------------------
 * TABLET VE ALTINDA KART ZORUNLU
 * ---------------------------------------------------------------------------
 * Geçiş yalnız `lg` ve üstünde görünüyor; altında kart çiziliyor. İki görünüm
 * CSS ile gizlenip birlikte render EDİLMİYOR: aynı düğmeler iki kez DOM'da
 * olurdu (ekran okuyucu ve testler ikisini de görür).
 */

export type DataPagePagination =
  | {
      mode: 'client';
      /** Varsayılan 20. */
      pageSize?: number;
    }
  | {
      mode: 'server';
      /** 0 tabanlı. */
      pageIndex: number;
      hasPrev: boolean;
      hasNext: boolean;
      onPrev: () => void;
      onNext: () => void;
    };

export interface DataPageProps<Row> {
  /**
   * Verilmezse sayfa başlığı ÇİZİLMEZ — liste bir sekmenin içindeyse başlık
   * sayfanın kendisinde durur. `actions` o durumda süzgeç satırının üstünde,
   * sağa yaslı çiziliyor.
   */
  title?: string;
  description?: string;
  /** CTA düğmeleri — başlığın sağında, dar ekranda altında. */
  actions?: ReactNode;
  /** Başlığın altındaki bilgi satırları (ör. "salt okunur"). */
  notice?: ReactNode;
  /** Süzgeç alanları; dar ekranda alt alta iner. */
  filters?: ReactNode;

  rows: readonly Row[];
  rowKey: (row: Row) => string;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;

  emptyTitle: string;
  emptyMessage?: string;

  /** Sayfanın kendi tablosu; yalnız o sayfanın satırlarını alır. */
  renderTable: (rows: readonly Row[]) => ReactNode;
  /** Sayfanın kendi kartı; ızgara ve `<li>` DataPage'in. */
  renderCard: (row: Row) => ReactNode;

  pagination: DataPagePagination;
  /** Tablo/kart tercihinin `localStorage` anahtarı — sayfa başına ayrı. */
  viewStorageKey: string;
  /** Client sayfalamada değişince 1. sayfaya dönülür (süzgeçlerin birleşimi). */
  resetKey?: string;
}

const DEFAULT_PAGE_SIZE = 20;

export function DataPage<Row>({
  title,
  description,
  actions,
  notice,
  filters,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyMessage,
  renderTable,
  renderCard,
  pagination,
  viewStorageKey,
  resetKey = '',
}: DataPageProps<Row>): ReactNode {
  const view = useViewMode(viewStorageKey);

  // Sayfa numarası süzgeç anahtarıyla birlikte tutuluyor: anahtar değişince
  // effect'le sıfırlamak yerine render sırasında 1 türetiliyor (titreme yok).
  const [pageState, setPageState] = useState({ key: resetKey, page: 1 });
  const pageSize = pagination.mode === 'client' ? (pagination.pageSize ?? DEFAULT_PAGE_SIZE) : 0;
  const pageCount = pagination.mode === 'client' ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  // Liste küçülünce (ör. pasife alma sonrası) boş bir sayfada kalınmıyor.
  const page = Math.min(pageState.key === resetKey ? pageState.page : 1, pageCount);

  const visibleRows =
    pagination.mode === 'client' ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;

  const showEmpty = !loading && error === null && rows.length === 0;
  const showData = !loading && rows.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {title === undefined ? (
        actions === undefined ? null : (
          <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
        )
      ) : (
        <PageHeader
          title={title}
          className="mb-0"
          {...(description === undefined ? {} : { description })}
          {...(actions === undefined ? {} : { actions })}
        />
      )}

      {notice}

      {filters !== undefined || view.canToggle ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          {filters === undefined ? null : (
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
              {filters}
            </div>
          )}
          {view.canToggle ? (
            <div className="shrink-0 lg:ml-auto">
              <Segmented label={t('list.viewMode')}>
                <SegmentButton
                  pressed={view.mode === 'table'}
                  onClick={() => view.setMode('table')}
                >
                  <List aria-hidden="true" />
                  {t('list.viewTable')}
                </SegmentButton>
                <SegmentButton pressed={view.mode === 'card'} onClick={() => view.setMode('card')}>
                  <LayoutGrid aria-hidden="true" />
                  {t('list.viewCard')}
                </SegmentButton>
              </Segmented>
            </div>
          ) : null}
        </div>
      ) : null}

      {error !== null ? (
        <Alert tone="danger">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            {onRetry === undefined ? null : (
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                {t('common.retry')}
              </Button>
            )}
          </span>
        </Alert>
      ) : null}

      {loading ? <LoadingSkeleton mode={view.mode} /> : null}

      {showEmpty ? (
        <EmptyState title={emptyTitle} {...(emptyMessage === undefined ? {} : { message: emptyMessage })} />
      ) : null}

      {showData ? (
        view.mode === 'table' ? (
          renderTable(visibleRows)
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleRows.map((row) => (
              <li key={rowKey(row)} className="min-w-0">
                {renderCard(row)}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {pagination.mode === 'client' ? (
        showData ? (
          <ClientPagination
            page={page}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={(next) => setPageState({ key: resetKey, page: next })}
          />
        ) : null
      ) : (
        <CursorPagination
          pageIndex={pagination.pageIndex}
          hasPrev={pagination.hasPrev}
          hasNext={pagination.hasNext}
          onPrev={pagination.onPrev}
          onNext={pagination.onNext}
          disabled={loading}
        />
      )}
    </div>
  );
}

function LoadingSkeleton({ mode }: { mode: 'table' | 'card' }): ReactNode {
  if (mode === 'card') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
