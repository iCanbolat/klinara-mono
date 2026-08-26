import { describe, it, expect } from 'vitest';
import { EnvValidationError, corsOrigins, validateEnv } from '../../src/config/env.validation';

/** Doğrulamayı geçen en küçük ortam. */
const MINIMAL = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'yeterince-uzun-bir-jwt-anahtari-32-karakter',
  FIELD_ENCRYPTION_KEY: 'dGVzdC1hbGFuLXNpZnJlbGVtZS1hbmFodGFyaS0zMmI=',
};

describe('env doğrulama', () => {
  it('zorunlu DATABASE_URL yoksa açılışta ölür', () => {
    expect(() => validateEnv({})).toThrow(EnvValidationError);
    try {
      validateEnv({});
      expect.unreachable();
    } catch (error) {
      expect((error as EnvValidationError).issues.join()).toContain('DATABASE_URL');
    }
  });

  it('postgres olmayan DATABASE_URL reddedilir', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(
      EnvValidationError,
    );
  });

  it('zorunlu alanlar verildiğinde güvenli varsayılanlarla açılır', () => {
    const env = validateEnv(MINIMAL);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.SHUTDOWN_GRACE_MS).toBe(10_000);
    expect(env.DATABASE_POOL_MAX).toBe(20);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.ARGON2_MEMORY_COST).toBe(19_456);
  });

  it('JWT_SECRET zorunlu ve en az 32 karakter olmalı', () => {
    const withoutSecret: Record<string, string> = { ...MINIMAL };
    delete withoutSecret['JWT_SECRET'];
    expect(() => validateEnv(withoutSecret)).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...MINIMAL, JWT_SECRET: 'kisa' })).toThrow(/JWT_SECRET/);
  });

  it('FIELD_ENCRYPTION_KEY 32 baytlık base64 olmalı', () => {
    expect(() => validateEnv({ ...MINIMAL, FIELD_ENCRYPTION_KEY: 'kisa' })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
  });

  it('geçersiz süre biçimi reddedilir', () => {
    expect(() => validateEnv({ ...MINIMAL, JWT_ACCESS_TTL: 'onbes-dakika' })).toThrow(
      /JWT_ACCESS_TTL/,
    );
  });

  it('PORT değerini sayıya çevirir', () => {
    const env = validateEnv({ ...MINIMAL, PORT: '8080' });
    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('geçersiz PORT için anlaşılır hata fırlatır', () => {
    expect(() => validateEnv({ ...MINIMAL, PORT: 'seksen' })).toThrow(EnvValidationError);
    try {
      validateEnv({ ...MINIMAL, PORT: '70000' });
      expect.unreachable('geçersiz PORT kabul edilmemeliydi');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join()).toContain('PORT');
      expect((error as EnvValidationError).message).toContain('PORT');
    }
  });

  it('geçersiz NODE_ENV reddedilir', () => {
    expect(() => validateEnv({ ...MINIMAL, NODE_ENV: 'staging' })).toThrow(EnvValidationError);
  });

  it('birden çok hatayı tek seferde bildirir', () => {
    try {
      validateEnv({ ...MINIMAL, PORT: 'x', LOG_LEVEL: 'verbose', NODE_ENV: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect((error as EnvValidationError).issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('bilinmeyen ortam değişkenleri yapılandırmaya SIZMAZ', () => {
    const env = validateEnv({ ...MINIMAL, KLINARA_BILINMEYEN: 'sizinti' });
    expect(Object.keys(env)).not.toContain('KLINARA_BILINMEYEN');
  });

  it('env nesnesi dondurulmuştur (kazara mutasyona kapalı)', () => {
    expect(Object.isFrozen(validateEnv(MINIMAL))).toBe(true);
  });

  it('CORS_ORIGINS listesini ayrıştırır ve boşlukları temizler', () => {
    const env = validateEnv({
      ...MINIMAL,
      CORS_ORIGINS: 'https://a.klinara.app, https://b.klinara.app ,',
    });
    expect(corsOrigins(env)).toEqual(['https://a.klinara.app', 'https://b.klinara.app']);
  });

  it('CORS_ORIGINS boşsa boş liste döner (çapraz origin kapalı)', () => {
    expect(corsOrigins(validateEnv(MINIMAL))).toEqual([]);
  });
});

describe('üretime özgü kurallar', () => {
  const PROD = {
    ...MINIMAL,
    NODE_ENV: 'production',
    METRICS_TOKEN: 'yeterince-uzun-metrik-tokeni',
    CORS_ORIGINS: 'https://app.klinara.app',
    APP_BASE_URL: 'https://app.klinara.app',
    WEBAUTHN_ORIGINS: 'https://app.klinara.app',
  };

  it('geçerli üretim yapılandırması kabul edilir', () => {
    expect(() => validateEnv(PROD)).not.toThrow();
  });

  it('üretimde METRICS_TOKEN zorunludur', () => {
    expect(() => validateEnv({ ...PROD, METRICS_TOKEN: 'kisa' })).toThrow(/METRICS_TOKEN/);
  });

  it('üretimde CORS_ORIGINS zorunludur', () => {
    expect(() => validateEnv({ ...PROD, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });

  it('üretimde passkey origin’i http olamaz', () => {
    expect(() => validateEnv({ ...PROD, WEBAUTHN_ORIGINS: 'http://app.klinara.app' })).toThrow(
      /WEBAUTHN_ORIGINS/,
    );
  });

  it('üretimde APP_BASE_URL https olmalı', () => {
    expect(() => validateEnv({ ...PROD, APP_BASE_URL: 'http://app.klinara.app' })).toThrow(
      /APP_BASE_URL/,
    );
  });
});
