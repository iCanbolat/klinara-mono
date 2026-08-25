import path from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { EnvValidationError, validateEnv, type EnvironmentVariables } from './env.validation';

/** Monorepo kökündeki tek `.env` dosyası — her uygulama aynı dosyayı okur. */
const ROOT_ENV_FILE = path.resolve(__dirname, '../../../../.env');

/**
 * `.env` dosyasını `process.env`e yükler.
 *
 * `ConfigModule` bu işi KASITLI olarak yapmaz (`ignoreEnvFile: true`): dosya
 * yükleme tek bir yerde, açıkça olsun. Testler `process.env`i kendileri kurar
 * ve geliştiricinin yerel `.env` dosyası testlere sızmaz.
 *
 * dotenv mevcut değişkenlerin ÜZERİNE YAZMAZ; gerçek ortam her zaman kazanır.
 */
export function loadEnvFile(): void {
  loadDotEnv({ path: ROOT_ENV_FILE, quiet: true });
}

/**
 * Süreç açılışı için: `.env` yükle, doğrula, hata varsa anlaşılır mesajla öl.
 *
 * Yığın izi değil okunabilir bir liste basar — yapılandırma hatasını gören kişi
 * genelde kodun içine bakacak durumda değildir.
 */
export function loadEnvOrExit(): EnvironmentVariables {
  loadEnvFile();
  try {
    return validateEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`\n[klinara-api] AÇILIŞ BAŞARISIZ\n${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  }
}
