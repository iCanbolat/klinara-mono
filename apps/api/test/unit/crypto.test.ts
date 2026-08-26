import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { durationFromNow, durationToSeconds } from '../../src/common/duration';
import { normalizePhone } from '../../src/common/phone';
import { FieldEncryptionService } from '../../src/common/crypto/field-encryption.service';
import {
  generateBackupCode,
  generateNumericCode,
  generateOpaqueToken,
  normalizeBackupCode,
  safeEqual,
  sha256,
} from '../../src/common/crypto/tokens';
import { testEnv } from '../helpers/env';

describe('süre çözümleme', () => {
  it('token ömrü ile veritabanı süresini AYNI kaynaktan üretir', () => {
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('30d')).toBe(2_592_000);
    expect(durationToSeconds('900s')).toBe(900);
    expect(durationToSeconds('1 h')).toBe(3_600);
  });

  it('geçersiz biçimi reddeder', () => {
    expect(() => durationToSeconds('onbes dakika')).toThrow();
    expect(() => durationToSeconds('15x')).toThrow();
  });

  it('gelecekteki zamanı hesaplar', () => {
    const target = durationFromNow('1h').getTime();
    expect(target - Date.now()).toBeGreaterThan(3_599_000);
    expect(target - Date.now()).toBeLessThan(3_601_000);
  });
});

describe('telefon normalizasyonu', () => {
  it('yerel yazımların hepsini AYNI E.164 değerine çevirir', () => {
    // Giriş tanımlayıcısı olduğu için bu şart: kullanıcı numarasını nasıl
    // yazarsa yazsın aynı hesaba düşmeli.
    for (const raw of ['0532 123 45 67', '+90 532 123 45 67', '+905321234567', '05321234567']) {
      expect(normalizePhone(raw)).toBe('+905321234567');
    }
  });

  it('geçersiz numarada null döner', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('numara-degil')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('yurt dışı numaralarını korur', () => {
    expect(normalizePhone('+49 30 123456')).toBe('+4930123456');
  });
});

describe('token yardımcıları', () => {
  it('opak token yüksek entropili ve URL güvenlidir', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(generateOpaqueToken()).not.toBe(token);
  });

  it('sha256 kararlıdır ve düz metni geri vermez', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toContain('abc');
    expect(sha256('abc')).toHaveLength(64);
  });

  it('sabit zamanlı karşılaştırma doğru çalışır', () => {
    expect(safeEqual('aynı', 'aynı')).toBe(true);
    expect(safeEqual('aynı', 'farklı')).toBe(false);
    expect(safeEqual('kısa', 'daha-uzun')).toBe(false);
  });

  it('sayısal kod tam uzunlukta ve baştaki sıfırları korur', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateNumericCode(6)).toMatch(/^\d{6}$/);
    }
  });

  it('yedek kod karışması kolay karakterler içermez', () => {
    const code = generateBackupCode();
    expect(code).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(code).not.toMatch(/[ilo01]/);
  });

  it('yedek kod karşılaştırması biçim farkını yok sayar', () => {
    const code = generateBackupCode();
    expect(normalizeBackupCode(code.toUpperCase())).toBe(normalizeBackupCode(code));
    expect(normalizeBackupCode(code.replaceAll('-', ' '))).toBe(normalizeBackupCode(code));
  });
});

describe('alan bazlı şifreleme (AES-256-GCM)', () => {
  const service = new FieldEncryptionService(new ConfigService(testEnv()));

  it('şifreler ve geri çözer', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = service.encrypt(secret);

    expect(encrypted).not.toContain(secret);
    expect(encrypted.split(':')).toHaveLength(4);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('aynı girdi HER SEFERİNDE farklı şifreli metin üretir (rastgele IV)', () => {
    expect(service.encrypt('aynı-değer')).not.toBe(service.encrypt('aynı-değer'));
  });

  it('anahtar kimliği şifreli metnin içinde taşınır (rotasyona hazır)', () => {
    expect(service.encrypt('x').split(':')[0]).toBe('v1');
  });

  it('KURCALANMIŞ şifreli metin sessizce bozuk veri DÖNDÜRMEZ, hata verir', () => {
    const encrypted = service.encrypt('bütünlük-testi');
    const parts = encrypted.split(':');
    const data = Buffer.from(parts[3] ?? '', 'base64url');
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[3] = data.toString('base64url');

    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });

  it('bozuk biçim reddedilir', () => {
    expect(() => service.decrypt('sadece-metin')).toThrow(/biçimi geçersiz/);
  });
});
