import { describe, it, expect } from 'vitest';
import { parseEnv, corsOrigins, EnvValidationError } from '../../src/config/env.js';

/** Doğrulamayı geçen en küçük ortam. */
const MINIMAL = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('env doğrulama', () => {
  it('zorunlu DATABASE_URL yoksa açılışta ölür', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    try {
      parseEnv({});
      expect.unreachable();
    } catch (error) {
      expect((error as EnvValidationError).issues.join()).toContain('DATABASE_URL');
    }
  });

  it('postgres olmayan DATABASE_URL reddedilir', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(
      EnvValidationError,
    );
  });

  it('zorunlu alanlar verildiğinde güvenli varsayılanlarla açılır', () => {
    const env = parseEnv(MINIMAL);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.SHUTDOWN_GRACE_MS).toBe(10_000);
    expect(env.DATABASE_POOL_MAX).toBe(20);
  });

  it('PORT değerini sayıya çevirir', () => {
    const env = parseEnv({ ...MINIMAL, PORT: '8080' });
    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('geçersiz PORT için anlaşılır hata fırlatır', () => {
    expect(() => parseEnv({ ...MINIMAL, PORT: 'seksen' })).toThrow(EnvValidationError);
    try {
      parseEnv({ ...MINIMAL, PORT: '70000' });
      expect.unreachable('geçersiz PORT kabul edilmemeliydi');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join()).toContain('PORT');
      expect((error as EnvValidationError).message).toContain('PORT');
    }
  });

  it('geçersiz NODE_ENV reddedilir', () => {
    expect(() => parseEnv({ ...MINIMAL, NODE_ENV: 'staging' })).toThrow(
      EnvValidationError,
    );
  });

  it('birden çok hatayı tek seferde bildirir', () => {
    try {
      parseEnv({ ...MINIMAL, PORT: 'x', LOG_LEVEL: 'verbose', NODE_ENV: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect((error as EnvValidationError).issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('env nesnesi dondurulmuştur (kazara mutasyona kapalı)', () => {
    const env = parseEnv(MINIMAL);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('CORS_ORIGINS listesini ayrıştırır ve boşlukları temizler', () => {
    const env = parseEnv({
      ...MINIMAL,
      CORS_ORIGINS: 'https://a.klinara.app, https://b.klinara.app ,',
    });
    expect(corsOrigins(env)).toEqual(['https://a.klinara.app', 'https://b.klinara.app']);
  });

  it('CORS_ORIGINS boşsa boş liste döner (çapraz origin kapalı)', () => {
    expect(corsOrigins(parseEnv(MINIMAL))).toEqual([]);
  });
});
