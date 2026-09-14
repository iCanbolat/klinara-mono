import * as React from 'react';

/**
 * Bir medya sorgusunun şu an eşleşip eşleşmediği.
 *
 * `use-mobile.ts` ile aynı gerekçe: `useSyncExternalStore`, değer render
 * sırasında okunur ve ilk karede yanlış düzen çizilmez. Sunucuda `false`
 * döner; sorguyu "eşleşince DAR ekran" olacak biçimde yazmak (ör.
 * `max-width`) SSR'ı ve `matches: false` test mock'unu masaüstüne sabitler.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind `lg` (1024px) altı: tablet ve telefon. */
export const BELOW_LG_QUERY = '(max-width: 1023px)';
