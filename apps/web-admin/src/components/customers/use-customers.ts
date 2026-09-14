'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Customer, Page } from '@klinara/shared';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';

/**
 * Müşteri defteri — CURSOR sayfalama.
 *
 * ---------------------------------------------------------------------------
 * SAYFA DEĞİŞTİRİLİYOR; GERİ DÖNÜŞ CURSOR YIĞINIYLA
 * ---------------------------------------------------------------------------
 * `GET /customers` cursor'lı: `pageInfo.nextCursor` bir SONRAKİ isteğin
 * `cursor`'ı. Offset ve toplam sayı yok, dolayısıyla "3. sayfaya git" de yok.
 * Arayüz Önceki / Sonraki gösteriyor: gidilen her sayfanın cursor'ı bir
 * yığında tutuluyor (`[null, CUR1, CUR2…]`) ve "Önceki" bir alttakini
 * yeniden istiyor. API geriye doğru cursor vermediği için başka yolu yok.
 *
 * Süzgeç değişince yığın SIFIRLANIYOR: eski cursor yeni süzgecin sonuç
 * kümesinde anlamsızdır ve sunucuya gönderilirse rastgele bir yerden devam eder.
 *
 * Arama ayrı bir uç (`customers/search`) ve o SAYFALANMIYOR; arama varken
 * gezinme gösterilmiyor.
 */

interface Filters {
  /** En az 2 karakter; altındaysa arama YAPILMIYOR (sunucu 400 verir). */
  query: string;
  tagId: string | null;
  source: string | null;
}

export interface CustomersState {
  customers: Customer[];
  error: string | null;
  loading: boolean;
  /** 0 tabanlı. */
  pageIndex: number;
  hasPrev: boolean;
  hasNext: boolean;
  next: () => void;
  prev: () => void;
  reload: () => void;
}

const MIN_QUERY = 2;
const PAGE_SIZE = '50';

export function useCustomers(filters: Filters): CustomersState {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  /** Gidilen sayfaların cursor'ları; son eleman ekrandaki sayfa. */
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const query = filters.query.trim();
  const searching = query.length >= MIN_QUERY;
  const filterKey = `${searching ? query : ''}|${filters.tagId ?? ''}|${filters.source ?? ''}`;

  // Süzgeç değişince yığın render sırasında sıfırlanıyor — effect'te yapmak
  // bir istek boyunca eski cursor'la yeni süzgeci birleştirirdi.
  const [stackKey, setStackKey] = useState(filterKey);
  if (stackKey !== filterKey) {
    setStackKey(filterKey);
    setStack([null]);
  }

  const cursor = stack.at(-1) ?? null;
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      setCustomers(null);
      setNextCursor(null);
      setError(null);
      try {
        if (searching) {
          // ⚠️ Arama ucu ÇIPLAK DİZİ dönüyor — `{ data }` zarfı YOK.
          // `.data` beklemek çalışma zamanında `undefined.map` olarak patlar.
          const result = await api.get<Customer[]>(
            `customers/search?q=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setCustomers(result);
          return;
        }

        const params = new URLSearchParams({ limit: PAGE_SIZE });
        if (cursor !== null) params.set('cursor', cursor);
        if (filters.tagId !== null) params.set('tagId', filters.tagId);
        if (filters.source !== null) params.set('source', filters.source);

        const result = await api.get<Page<Customer>>(`customers?${params.toString()}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCustomers(result.data);
        setNextCursor(result.pageInfo.hasMore ? result.pageInfo.nextCursor : null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();

    return () => controller.abort();
  }, [searching, query, cursor, filters.tagId, filters.source, nonce]);

  const next = useCallback(() => {
    if (nextCursor === null) return;
    setStack((current) => [...current, nextCursor]);
  }, [nextCursor]);

  const prev = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  return {
    customers: customers ?? [],
    error,
    loading: customers === null && error === null,
    pageIndex: searching ? 0 : stack.length - 1,
    // Arama sayfalanmıyor; gezinme gösterilmiyor.
    hasPrev: !searching && stack.length > 1,
    hasNext: !searching && nextCursor !== null,
    next,
    prev,
    reload,
  };
}
