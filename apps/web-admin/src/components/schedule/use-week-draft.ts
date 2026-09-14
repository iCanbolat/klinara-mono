'use client';

import { useCallback, useMemo, useState } from 'react';
import { changedDays, emptyWeek, validateWeek, type DayDraft, type DayIssue } from '@/lib/schedule/entries';

/**
 * Bir haftalık planın KAYITLI hâli ile TASLAĞI.
 *
 * Sekmeler arası geçişte taslak kaybolmasın diye state sayfada tutuluyor
 * (bkz. `working-hours-page.tsx`); sekme bileşenleri yalnız bu nesneyi alıyor.
 * `saved === null` henüz yüklenmedi demek — o sırada hiçbir gün "değişmiş"
 * sayılmıyor, yoksa ilk karede kaydet çubuğu yanıp sönerdi.
 */
export interface WeekDraft {
  draft: DayDraft[];
  loaded: boolean;
  /** Kayıtlı hâlden farklı günler (`dayOfWeek`). */
  changed: number[];
  dirty: boolean;
  issues: DayIssue[];
  setDraft: (days: DayDraft[]) => void;
  /** Sunucudan gelen (ya da az önce kaydedilen) hâli kayıtlı say. */
  load: (days: DayDraft[]) => void;
  reset: () => void;
  clear: () => void;
}

export function useWeekDraft(): WeekDraft {
  const [saved, setSaved] = useState<DayDraft[] | null>(null);
  const [draft, setDraft] = useState<DayDraft[]>(() => emptyWeek());

  const load = useCallback((days: DayDraft[]) => {
    setSaved(days);
    setDraft(days);
  }, []);

  const reset = useCallback(() => {
    if (saved !== null) setDraft(saved);
  }, [saved]);

  const clear = useCallback(() => {
    setSaved(null);
    setDraft(emptyWeek());
  }, []);

  const changed = useMemo(() => (saved === null ? [] : changedDays(draft, saved)), [draft, saved]);
  const issues = useMemo(() => validateWeek(draft), [draft]);

  return {
    draft,
    loaded: saved !== null,
    changed,
    dirty: changed.length > 0,
    issues,
    setDraft,
    load,
    reset,
    clear,
  };
}
