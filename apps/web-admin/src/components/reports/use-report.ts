'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBranch } from '@/components/session/branch-provider';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { presetRange, rangeQuery, type PeriodPreset, type PeriodRange } from '@/lib/reports/period';

/**
 * Rapor çeken ortak kanca.
 *
 * Panelde react-query yok ve bu batch onu getirmiyor: mevcut sayfalar
 * `useState` + `useCallback(load)` + `useEffect` kalıbını kullanıyor ve beş
 * rapor sayfası için bir veri katmanı kütüphanesi eklemek, kalıbı ikiye
 * bölmek olurdu. Kanca yalnız o kalıbı tek yere topluyor.
 *
 * `void (async () => …)()` sarmalayıcısı bilerek: `react-hooks/set-state-in-effect`
 * kuralı efektin doğrudan `async` olmasına izin vermiyor.
 */

interface Options {
  /** Proxy yolu, `/api/a/` sonrası — örn. `reports/revenue`. */
  path: string;
  preset: PeriodPreset;
  compare: boolean;
  groupBy?: string | undefined;
}

export interface ReportState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  range: PeriodRange;
  branchId: string | null;
  reload: () => void;
}

export function useReport<T>({ path, preset, compare, groupBy }: Options): ReportState<T> {
  const { branchId, loading: branchLoading } = useBranch();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const range = presetRange(preset);
  const rangeKey = `${range.from}|${range.to}`;

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    // Şube listesi gelmeden istek atmak, kullanıcının seçili şubesi
    // yüklendiğinde ikinci bir isteği tetikler ve ilkinin yanıtı geç gelirse
    // yanlış veriyi ekrana basardı.
    if (branchLoading) return;

    const controller = new AbortController();

    // Sıfırlama efektin GÖVDESİNDE değil, async sarmalayıcının içinde:
    // `react-hooks/set-state-in-effect` senkron `setState`i basamaklı render
    // uyarısıyla reddediyor ve panelin geri kalanı da bu kalıbı kullanıyor.
    void (async () => {
      setData(null);
      setError(null);
      try {
        const extra: Record<string, string> = {};
        if (compare) extra.compareTo = 'previous';
        if (groupBy !== undefined) extra.groupBy = groupBy;
        // Şube SORGUDA gitmek zorunda: rapor uçlarının kapsamını
        // `ReportScopeService.resolve(principal, query.branchId)` çözüyor,
        // `x-branch-id` başlığını OKUMUYOR. Başlık yine gönderiliyor (istek
        // bağlamı ve loglar onu kullanıyor) ama daraltmayı yapan bu parametre;
        // yalnız başlığa güvenildiğinde şube seçimi sessizce yok sayılıyor ve
        // rapor "erişebildiğim tüm şubeler" için hesaplanıyordu.
        if (branchId !== null) extra.branchId = branchId;
        const query = rangeQuery({ from: range.from, to: range.to }, extra);
        const result = await api.get<T>(`${path}?${query}`, {
          signal: controller.signal,
          ...(branchId === null ? {} : { branchId }),
        });
        setData(result);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();

    return () => controller.abort();
    // `range` her render'da yeni nesne; kimliği yerine DEĞERİ izleniyor.
  }, [path, rangeKey, compare, groupBy, branchId, branchLoading, nonce, range.from, range.to]);

  return {
    data,
    error,
    loading: data === null && error === null,
    range,
    branchId,
    reload,
  };
}
