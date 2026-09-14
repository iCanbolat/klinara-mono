'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { BELOW_LG_QUERY, useMediaQuery } from '@/hooks/use-media-query';

/**
 * Liste sayfalarında tablo mu kart mı.
 *
 * `calendar/use-calendar-mode.ts` deseni, ama anahtar sayfa başına: müşteride
 * tablo seçen kullanıcı personelde kartı tercih edebilir.
 *
 * ---------------------------------------------------------------------------
 * TABLET VE ALTINDA KART ZORUNLU — TERCİH SİLİNMİYOR
 * ---------------------------------------------------------------------------
 * `lg` altında tablo yatay kaymak zorunda kalıyor; orada seçim hiç
 * sunulmuyor. Saklanan tercih ise yerinde duruyor: tablet yatay çevrilince
 * ya da pencere genişleyince kullanıcının seçimi geri geliyor.
 */

export type ViewMode = 'table' | 'card';

const listeners = new Set<() => void>();
/** Depolama kapalıyken (gizli sekme) oturum boyunca geçerli seçimler. */
const memory = new Map<string, ViewMode>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readStored(key: string): ViewMode | null {
  try {
    const value = globalThis.localStorage?.getItem(key) ?? null;
    return value === 'table' || value === 'card' ? value : (memory.get(key) ?? null);
  } catch {
    return memory.get(key) ?? null;
  }
}

export interface ViewModeState {
  /** Ekrana çizilecek görünüm — dar ekranda her zaman `card`. */
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  /** Geçiş gösterilmeli mi (yalnız `lg` ve üstü). */
  canToggle: boolean;
}

export function useViewMode(storageKey: string): ViewModeState {
  const belowLg = useMediaQuery(BELOW_LG_QUERY);
  const stored = useSyncExternalStore(
    subscribe,
    () => readStored(storageKey),
    () => null,
  );

  const setMode = useCallback(
    (mode: ViewMode) => {
      try {
        globalThis.localStorage.setItem(storageKey, mode);
      } catch {
        memory.set(storageKey, mode);
      }
      for (const listener of listeners) listener();
    },
    [storageKey],
  );

  return {
    mode: belowLg ? 'card' : (stored ?? 'table'),
    setMode,
    canToggle: !belowLg,
  };
}
