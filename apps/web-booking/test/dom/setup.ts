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
