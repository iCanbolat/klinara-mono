'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarResponse } from '@klinara/shared';
import { useBranch } from '@/components/session/branch-provider';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { nextPollDelay } from '@/lib/domains/poll';
import { addDays, weekStart, type DayKey } from '@/lib/calendar/date';

/**
 * Takvim verisi — `use-report.ts` kalıbı, iki eklemeyle.
 *
 * ---------------------------------------------------------------------------
 * EKLEME 1 — ŞUBE HEM SORGUDA HEM BAŞLIKTA
 * ---------------------------------------------------------------------------
 * `GET /calendar/*` ve `GET /availability` `@RequireBranchScope()` taşıyor:
 * `PermissionsGuard` `X-Branch-Id` BAŞLIĞI yoksa 400 veriyor. Ayrıca DTO
 * `branchId` SORGU parametresini zorunlu tutuyor. Yani ikisi de gerekli ve
 * yalnız birini göndermek garantili bir hata. (Raporlarda yalnız sorgu
 * okunuyordu; burada durum farklı ve bu fark sessizce unutulabilecek cinsten.)
 *
 * Şube seçili değilse istek HİÇ ATILMIYOR: `x-branch-id` başlıksız bir çağrı
 * 400 döner ve kullanıcı sebebi anlaşılmayan bir hata görürdü. Bunun yerine
 * "şube seçin" durumu dönüyor.
 *
 * ---------------------------------------------------------------------------
 * EKLEME 2 — CANLI TAZELEME
 * ---------------------------------------------------------------------------
 * Takvim paylaşılan bir ekran: resepsiyon randevu yazarken uygulayıcı aynı
 * günü açık tutuyor. `lib/domains/poll.ts` yeniden kullanılıyor (5s → 15s →
 * 30s, beş dakika sonra dur, sekme gizliyken atla).
 *
 * Yoklama her MUTASYONDAN sonra sıfırlanıyor (`reload`): kullanıcı bir şey
 * yaptıysa ekranın canlı kalması gereken pencere yeniden başlar.
 */

export type CalendarView = 'day' | 'week';

interface Options {
  view: CalendarView;
  /** Gün görünümünde gösterilen gün; hafta görünümünde haftanın herhangi bir günü. */
  day: DayKey;
  staffProfileId: string | null;
}

export interface CalendarState {
  data: CalendarResponse | null;
  error: string | null;
  loading: boolean;
  /** Şube seçilmemiş — istek atılmadı, hata da yok. */
  needsBranch: boolean;
  /** Yoklama beş dakikayı doldurdu; kullanıcıya elle yenileme öneriliyor. */
  pollStopped: boolean;
  branchId: string | null;
  reload: () => void;
}

export function useCalendar({ view, day, staffProfileId }: Options): CalendarState {
  const { branchId, loading: branchLoading } = useBranch();
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [pollStopped, setPollStopped] = useState(false);

  const pollStartedAt = useRef<number | null>(null);
  const pollAttempt = useRef(0);

  const reload = useCallback(() => {
    // Mutasyondan sonra yoklama penceresi yeniden başlar.
    pollStartedAt.current = null;
    pollAttempt.current = 0;
    setPollStopped(false);
    setNonce((value) => value + 1);
  }, []);

  const anchor = view === 'week' ? weekStart(day) : day;
  const needsBranch = !branchLoading && branchId === null;

  useEffect(() => {
    if (branchLoading) return;
    if (branchId === null) return;

    const controller = new AbortController();

    void (async () => {
      setError(null);
      try {
        const params = new URLSearchParams({ branchId });
        if (view === 'day') params.set('date', anchor);
        else params.set('weekStart', anchor);
        if (staffProfileId !== null) params.set('staffProfileId', staffProfileId);

        const result = await api.get<CalendarResponse>(`calendar/${view}?${params.toString()}`, {
          signal: controller.signal,
          // Başlık ŞART: uç `@RequireBranchScope()` taşıyor.
          branchId,
        });
        if (controller.signal.aborted) return;
        setData(result);
      } catch (caught) {
        if (controller.signal.aborted) return;
        // Veri SIFIRLANMIYOR: bir yoklama isteği başarısız olduğunda ekrandaki
        // takvimi boşaltmak, geçici bir ağ hatasını veri kaybı gibi gösterir.
        setError(toMessage(caught));
      }
    })();

    return () => controller.abort();
  }, [view, anchor, staffProfileId, branchId, branchLoading, nonce]);

  // Yoklama. Veri gelmeden başlamıyor — ilk yükleme zaten yolda.
  useEffect(() => {
    if (data === null || pollStopped || branchId === null) return;

    pollStartedAt.current ??= Date.now();
    const delay = nextPollDelay(pollAttempt.current, Date.now() - (pollStartedAt.current ?? 0));
    if (delay === null) {
      void (async () => {
        await Promise.resolve();
        setPollStopped(true);
      })();
      return;
    }

    const timer = setTimeout(() => {
      // Sekme gizliyken sorgu atmak, açık duran onlarca sekmeden gereksiz yük
      // demek. Sayaç ilerlemiyor: kullanıcı geri döndüğünde taze veri alsın.
      if (document.hidden) return;
      pollAttempt.current += 1;
      setNonce((value) => value + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [data, pollStopped, branchId, nonce]);

  return {
    data,
    error,
    loading: data === null && error === null && !needsBranch,
    needsBranch,
    pollStopped,
    branchId,
    reload,
  };
}

/** Gezinme yardımcısı — gün görünümünde 1, hafta görünümünde 7 gün. */
export function shiftDay(day: DayKey, view: CalendarView, direction: -1 | 1): DayKey {
  return addDays(day, direction * (view === 'week' ? 7 : 1));
}
