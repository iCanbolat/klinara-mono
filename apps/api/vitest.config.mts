import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/helpers/setup-env.ts'],
    // Testcontainers ile gerçek PostgreSQL ayağa kalkması zaman alır.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Entegrasyon testleri paylaşılan bir veritabanı kullanır; dosyalar sırayla koşar.
    // (Yarış koşulu testleri kendi eş zamanlı bağlantılarını içeriden açar.)
    fileParallelism: false,
  },
  plugins: [
    // Vitest'in varsayılan dönüştürücüsü esbuild'dir ve `emitDecoratorMetadata`
    // ÜRETMEZ — bu da NestJS'in bağımlılık enjeksiyonunu testlerde tamamen bozar
    // ("Nest can't resolve dependencies"). SWC dekoratör metadata'sını üretir.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
      sourceMaps: true,
    }),
  ],
});
