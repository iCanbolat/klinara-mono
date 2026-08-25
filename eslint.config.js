import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'klinara-ios/**', '**/coverage/**'] },
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
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Fastify'da `async` handler/plugin imzası sözleşmenin parçasıdır; içinde
      // `await` olmaması bir hata değildir.
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
    files: ['**/src/modules/**/repository.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/client.js', '**/db/client'],
              message:
                'Repository global `db` handle\'ını kullanamaz. Fonksiyon imzasına `tx: Tx` ekleyin ve çağıranı `app.tenantTx(...)` içine alın.',
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
    files: ['**/src/config/env.ts', '**/test/**/*.ts', '**/*.config.ts', 'eslint.config.js'],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
);
