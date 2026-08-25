import { parseEnv, type Env } from '../../src/config/env.js';

/** Testler için geçerli, sessiz bir env. */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://klinara_app:pw@127.0.0.1:5433/klinara_test',
    ...overrides,
  });
}
