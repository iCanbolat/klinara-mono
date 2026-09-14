'use client';

import { useEffect, useState } from 'react';

/**
 * Dakikada bir tazelenen "şimdi" — ızgaradaki şimdiki saat çizgisi için.
 *
 * `Date.now()` render içinde çağrılsaydı çizgi yalnız başka bir sebeple
 * yeniden render olunca kayardı; bu kanca onu kendi saatine bağlıyor.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
