import { describe, it, expect } from 'vitest';
import { isPgError, pgConstraintName, pgErrorCode, PG_ERROR } from '../../src/lib/db-errors.js';

describe('PostgreSQL hata kodu çıkarımı', () => {
  it('doğrudan hatadan kodu okur', () => {
    expect(pgErrorCode({ code: '23505' })).toBe('23505');
  });

  it('Drizzle tarafından SARMALANMIŞ hatadan kodu çıkarır', () => {
    // Gerçek dünyada gelen şekil: DrizzleQueryError → cause → pg hatası.
    const wrapped = new Error('Failed query: insert into ...', {
      cause: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'tenants_slug_key',
      }),
    });
    expect(pgErrorCode(wrapped)).toBe('23505');
    expect(isPgError(wrapped, PG_ERROR.UNIQUE_VIOLATION)).toBe(true);
    expect(pgConstraintName(wrapped)).toBe('tenants_slug_key');
  });

  it('iki kat sarmalanmış hatada da çalışır', () => {
    const inner = Object.assign(new Error('exclusion'), { code: '23P01' });
    const wrapped = new Error('dış', { cause: new Error('orta', { cause: inner }) });
    expect(isPgError(wrapped, PG_ERROR.EXCLUSION_VIOLATION)).toBe(true);
  });

  it('PostgreSQL kodu olmayan `code` alanlarını yok sayar', () => {
    // Node hataları da `code` taşır (ör. ECONNREFUSED) — PG kodu sanılmamalı.
    expect(pgErrorCode({ code: 'ECONNREFUSED' })).toBeUndefined();
    expect(pgErrorCode({ code: 'ERR_INVALID_ARG_TYPE' })).toBeUndefined();
  });

  it('kod yoksa undefined döner ve sonsuz döngüye girmez', () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(pgErrorCode(cyclic)).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode('metin')).toBeUndefined();
  });
});
