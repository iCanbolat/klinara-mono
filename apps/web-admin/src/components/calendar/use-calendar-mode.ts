'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * Izgara mı ajanda mı.
 *
 * Kullanıcı bir kez seçtiyse seçimi `localStorage`ta duruyor (şube tercihi
 * gibi bir çalışma bağlamı — `branch-provider.tsx`). Seçmediyse ekran
 * genişliği karar veriyor: telefonda ajanda, üstünde ızgara.
 *
 * `useSyncExternalStore`, `useState` + `useEffect` DEĞİL — gerekçe
 * `hooks/use-mobile.ts` ile aynı: ilk render'da yanlış görünümü bir kare
 * çizip effect'te düzeltmek hem titreme hem `set-state-in-effect` uyarısı.
 * Sunucu anlık görüntüsü `null` (seçim yok) → hidrasyon uyuşmazlığı olmuyor.
 */

export type CalendarMode = 'grid' | 'agenda';

const STORAGE_KEY = 'klinara.admin.calendarMode';
const listeners = new Set<() => void>();
/**
 * Depolama kapalıyken (gizli sekme) seçimin oturum boyunca geçerli kalması için
 * bellek yedeği. YALNIZ yazma başarısız olduğunda dolduruluyor; aksi hâlde
 * depolama temizlendiğinde eski seçim bellekten geri dönerdi.
 */
let memory: CalendarMode | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readStored(): CalendarMode | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    return value === 'grid' || value === 'agenda' ? value : memory;
  } catch {
    return memory;
  }
}

export function useCalendarMode(): [CalendarMode, (mode: CalendarMode) => void] {
  const isMobile = useIsMobile();
  const stored = useSyncExternalStore(subscribe, readStored, () => null);

  const setMode = useCallback((mode: CalendarMode) => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Gizli sekmede yazma fırlıyor; tercih kalıcı olmaz ama geçiş yine
      // çalışmalı.
      memory = mode;
    }
    for (const listener of listeners) listener();
  }, []);

  return [stored ?? (isMobile ? 'agenda' : 'grid'), setMode];
}
