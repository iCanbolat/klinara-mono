import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * `globals: false` olduğu için Testing Library kendi otomatik temizliğini
 * KURAMIYOR: testler arasında DOM birikiyor ve `getAllByRole` bir önceki
 * testin ögelerini de sayıyor. Temizliği elle bağlıyoruz.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom `matchMedia` uygulamıyor; `hooks/use-mobile.ts` (ve onu kullanan
 * `ui/sidebar.tsx`) ona bağlı. Yokluğunda bileşen render sırasında patlıyor.
 *
 * Sabit `false`: testler masaüstü genişliğini varsayıyor. Mobil davranışı
 * sınamak gerekirse test kendi `matchMedia`sını kurmalı.
 */
if (typeof window !== 'undefined' && window.matchMedia === undefined) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
