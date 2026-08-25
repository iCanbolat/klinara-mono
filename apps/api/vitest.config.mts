import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    // Testcontainers ile gerçek PostgreSQL ayağa kalkması zaman alır.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Entegrasyon testleri paylaşılan bir veritabanı kullanır; dosyalar sırayla koşar.
    // (Yarış koşulu testleri kendi eş zamanlı bağlantılarını içeriden açar.)
    fileParallelism: false,
  },
});
