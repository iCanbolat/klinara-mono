import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * İki proje: saf mantık `node`'da, bileşenler `jsdom`'da.
 *
 * API'nin `unplugin-swc` eklentisi BURAYA KOPYALANMIYOR — o eklenti Nest'in
 * dekoratör metadata'sı için var ve React tarafında hiçbir işe yaramaz.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
  },
  test: {
    globals: false,
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['test/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['test/dom/**/*.test.tsx'],
          setupFiles: ['test/dom/setup.ts'],
        },
      },
    ],
  },
});
