import { validateEnv, type EnvironmentVariables } from '../../src/config/env.validation';

/** Testler için geçerli, sessiz bir ortam. */
const BASE: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://klinara_app:pw@127.0.0.1:5433/klinara_test',
};

/**
 * `validateEnv`in tanıdığı tüm anahtarlar.
 *
 * Test ortamı kurulurken ÖNCE hepsi silinir: geliştiricinin kabuğunda duran bir
 * `PLATFORM_ADMIN_TOKEN` testin sonucunu değiştirmemeli.
 */
const MANAGED_KEYS = Object.keys(validateEnv(BASE));

export function testEnv(overrides: Record<string, string> = {}): EnvironmentVariables {
  return validateEnv({ ...BASE, ...overrides });
}

/**
 * `process.env`i test için kurar. `ConfigModule` değerleri modül derlenirken
 * okuduğu için uygulama OLUŞTURULMADAN ÖNCE çağrılmalıdır.
 */
export function applyTestEnv(overrides: Record<string, string> = {}): void {
  for (const key of MANAGED_KEYS) delete process.env[key];
  Object.assign(process.env, BASE, overrides);
}
