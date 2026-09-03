import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'klinara-ios/**',
      '**/coverage/**',
      '**/.next/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // NestJS'in DI'ı `emitDecoratorMetadata` ile üretilen tip bilgisine dayanır.
      // `import type` ile alınan bir sınıf metadata'ya YAZILMAZ ve enjeksiyon
      // "Nest can't resolve dependencies" ile patlar; bu yüzden bu kural kapalı.
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // NestJS'te `async` controller/handler imzası sözleşmenin parçasıdır;
      // içinde `await` olmaması bir hata değildir.
      '@typescript-eslint/require-await': 'off',
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            "process.env'e doğrudan erişmeyin. Tek giriş noktası src/config/env.ts (getEnv/parseEnv).",
        },
      ],
    },
  },
  {
    // Repository'ler kiracı context'i taşıyan `tx` dışında bir veritabanı
    // handle'ı kullanamaz.
    //
    // Sebep: `app.tenant_id` ayarı TRANSACTION kapsamlıdır. Global `db`
    // üzerinden koşan bir sorgu ya RLS yüzünden boş küme görür ya da — çok daha
    // kötüsü — havuzdan gelen bağlantıda başka bir kiracının context'iyle
    // çalışır. Kuralı yoruma bırakmıyoruz, lint'e bağlıyoruz.
    files: ['**/src/modules/**/*.repository.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/database/database.constants', '**/database/database.module'],
              message:
                "Repository global `db` handle'ını kullanamaz. Fonksiyon imzasına `tx: Tx` ekleyin ve çağıranı `TenantTxService.run(...)` içine alın.",
            },
          ],
        },
      ],
    },
  },
  {
    // --- Next uygulamaları ---
    files: ['apps/web-*/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // RSC'de `await params` yaygın; Nest tarafındaki gerekçe burada geçerli değil.
      '@typescript-eslint/no-misused-promises': 'off',
      // App Router; `pages/` dizini yok ve olmayacak.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    // Yetkili yukarı akış çağrıları YALNIZ Route Handler'da yapılabilir.
    //
    // Sebep Next 15'in bir kısıtı: `cookies().set()` bir RSC içinde çağrıldığında
    // fırlıyor. Yetkili her çağrı, erişim token'ının süresi dolmuşsa yenileme ve
    // cookie yazma gerektirebilir — bu iş RSC'de YAPILAMAZ. Kural yoruma
    // bırakılsaydı, aylar sonra birinin bir layout'a `await callUpstream(...)`
    // yazmasıyla sessizce kırılırdı ve hata mesajı sebebi anlatmazdı.
    //
    // Repository/`tx` kuralıyla aynı gerekçe: mimari sınır belgelenmiyor,
    // zorlanıyor.
    files: ['apps/web-admin/src/**/*.{ts,tsx}'],
    ignores: ['apps/web-admin/src/app/api/**', 'apps/web-admin/src/lib/session/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/session/upstream', '@/lib/session/upstream', '**/session/store', '@/lib/session/store'],
              message:
                'Yukarı akış çağrısı ve cookie yazımı yalnız Route Handler içinde yapılabilir (RSC Set-Cookie yapamaz). Tarayıcıdan `lib/api/client.ts` kullanın.',
            },
          ],
        },
      ],
    },
  },
  {
    // Pazarlama blokları SUNUCU bileşeni olarak kalmak ZORUNDA: Radix'in tek
    // bir importu istemci bundle'ını public sayfaya taşır ve 11.1'in
    // Lighthouse >= 90 / LCP < 2.0 s kriterini sessizce düşürür. Sınır
    // belgelenmiyor, zorlanıyor.
    files: ['apps/web-*/src/components/blocks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@radix-ui/*', '@/components/ui/*', '**/components/ui/*'],
              message:
                'Pazarlama blokları sunucu bileşenidir. Radix/shadcn yalnız /randevu ve /r rotalarında kullanılabilir.',
            },
          ],
        },
      ],
    },
  },
  {
    // Yapılandırma JS dosyaları tip bilgisiyle lint edilmez.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // env.ts, testler ve yapılandırma dosyaları process.env'i okumak zorunda.
    files: [
      '**/src/config/*.ts',
      '**/src/main.ts',
      '**/test/**/*.ts',
      '**/*.config.ts',
      'eslint.config.js',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
);
