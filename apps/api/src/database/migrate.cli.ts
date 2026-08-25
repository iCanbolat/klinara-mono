import { loadEnvOrExit } from '../config/load-env';
import { runMigrations } from './migrate';

/**
 * CLI: `pnpm db:migrate`
 *
 * Kütüphaneden (`migrate.ts`) ayrı bir dosyadır: `runMigrations` testler ve
 * `/readyz` tarafından import edilir, o import'un yan etkisi olarak migration
 * KOŞMAMALIDIR.
 */
async function cli(): Promise<void> {
  const env = loadEnvOrExit();
  const url = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL;

  if (env.DATABASE_MIGRATION_URL === undefined) {
    process.stderr.write(
      '[migrate] UYARI: DATABASE_MIGRATION_URL tanımlı değil, DATABASE_URL kullanılıyor.\n' +
        '          Üretimde migration ayrı bir sahip rolüyle koşmalıdır.\n',
    );
  }

  const result = await runMigrations(url);
  for (const name of result.applied) process.stdout.write(`[migrate] uygulandı: ${name}\n`);
  process.stdout.write(
    `[migrate] tamamlandı — ${result.applied.length} uygulandı, ${result.skipped.length} zaten mevcut\n`,
  );
}

cli().catch((error: unknown) => {
  process.stderr.write(`[migrate] BAŞARISIZ\n${String(error)}\n`);
  process.exit(1);
});
