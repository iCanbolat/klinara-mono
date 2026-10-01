'use client';

import { useEffect, useState } from 'react';

/** Değer `delayMs` boyunca değişmeyince güncellenir; yazarken her tuşta istek atmamak için. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
