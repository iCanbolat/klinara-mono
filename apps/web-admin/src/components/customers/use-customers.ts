'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Customer, Page } from '@klinara/shared';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';

/**
 * Müşteri defteri — CURSOR sayfalama.
 *
 * ---------------------------------------------------------------------------
 * SAYFA EKLENİYOR, DEĞİŞTİRİLMİYOR
 * ---------------------------------------------------------------------------
 * `GET /customers` cursor'lı: `pageInfo.nextCursor` bir SONRAKİ isteğin
 * `cursor`'ı. Offset sayfalama yok, dolayısıyla "3. sayfaya git" diye bir
 * şey de yok — arayüz "daha fazla" düğmesiyle listeye EKLİYOR.
 *
 * Süzgeç değişince liste SIFIRLANIYOR ve cursor atılıyor: eski cursor yeni
 * süzgecin sonuç kümesinde anlamsızdır ve sunucuya gönderilirse rastgele bir
 * yerden devam eder.
 *
 * Arama ayrı bir uç (`customers/search`) ve o SAYFALANMIYOR; bu yüzden arama
 * varken `nextCursor` hep `null` gibi davranıyor — kullanıcıya "daha fazla"
 * gösterilmiyor.
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
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

const MIN_QUERY = 2;

export function useCustomers(filters: Filters): CustomersState {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);

  const searching = filters.query.trim().length >= MIN_QUERY;
  const filterKey = `${filters.query.trim()}|${filters.tagId ?? ''}|${filters.source ?? ''}`;

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  // İlk sayfa / süzgeç değişimi.
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      setCustomers(null);
      setCursor(null);
      setHasMore(false);
      setError(null);
      try {
        if (searching) {
          // ⚠️ Arama ucu ÇIPLAK DİZİ dönüyor — `{ data }` zarfı YOK.
          // `.data` beklemek çalışma zamanında `undefined.map` olarak patlar.
          const result = await api.get<Customer[]>(
            `customers/search?q=${encodeURIComponent(filters.query.trim())}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setCustomers(result);
          return;
        }

        const params = new URLSearchParams({ limit: '50' });
        if (filters.tagId !== null) params.set('tagId', filters.tagId);
        if (filters.source !== null) params.set('source', filters.source);

        const result = await api.get<Page<Customer>>(`customers?${params.toString()}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCustomers(result.data);
        setCursor(result.pageInfo.nextCursor);
        setHasMore(result.pageInfo.hasMore);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();

    return () => controller.abort();
  }, [filterKey, searching, filters.query, filters.tagId, filters.source, nonce]);

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;

    void (async () => {
      setLoadingMore(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: '50', cursor });
        if (filters.tagId !== null) params.set('tagId', filters.tagId);
        if (filters.source !== null) params.set('source', filters.source);

        const result = await api.get<Page<Customer>>(`customers?${params.toString()}`);
        // EKLİYOR, değiştirmiyor.
        setCustomers((current) => [...(current ?? []), ...result.data]);
        setCursor(result.pageInfo.nextCursor);
        setHasMore(result.pageInfo.hasMore);
      } catch (caught) {
        setError(toMessage(caught));
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [cursor, loadingMore, filters.tagId, filters.source]);

  return {
    customers: customers ?? [],
    error,
    loading: customers === null && error === null,
    loadingMore,
    // Arama sayfalanmıyor; "daha fazla" gösterilmiyor.
    hasMore: !searching && hasMore && cursor !== null,
    loadMore,
    reload,
  };
}
