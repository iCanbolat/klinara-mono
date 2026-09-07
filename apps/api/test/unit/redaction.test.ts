import { describe, it, expect } from 'vitest';
import { maskEmail, maskPhone, sanitizeUrl, REDACT_PATHS, censor } from '../../src/observability/redaction';

describe('log gizleme (Batch 10.3 yeniden denetimi)', () => {
  describe('sanitizeUrl', () => {
    it('yol içindeki opaque token’ı gizler, yol yapısını korur', () => {
      // `generateOpaqueToken()` 32 bayt → 43 karakter base64url üretir.
      const token = 'F2xJ8kQ1sN0pR7tV3wY6zA9bC4dE5fG8hI1jK2lM3nO';
      expect(sanitizeUrl(`/api/v1/public/sites/guzel-klinik/appointments/${token}`)).toBe(
        '/api/v1/public/sites/guzel-klinik/appointments/[GİZLENDİ]',
      );
    });

    it('UUID’leri gizlemez — kimlikler sır değildir ve iz sürmenin kendisidir', () => {
      const url = '/api/v1/customers/7f3a1c62-4d5e-4f70-8a91-2b3c4d5e6f70/notes';
      expect(sanitizeUrl(url)).toBe(url);
    });

    it('slug ve kısa parçalar dokunulmadan kalır', () => {
      expect(sanitizeUrl('/api/v1/public/sites/guzel-klinik/services')).toBe(
        '/api/v1/public/sites/guzel-klinik/services',
      );
    });

    it('hassas sorgu parametresi kısa olsa da gizlenir', () => {
      expect(sanitizeUrl('/uploads/local/get?key=abc&sig=kisa')).toBe(
        '/uploads/local/get?key=[GİZLENDİ]&sig=[GİZLENDİ]',
      );
    });

    it('adı masum ama değeri opaque olan parametre de gizlenir', () => {
      expect(sanitizeUrl('/x?ref=F2xJ8kQ1sN0pR7tV3wY6zA9bC4dE5fG8hI1jK2lM3nO')).toBe(
        '/x?ref=[GİZLENDİ]',
      );
    });

    it('sayfalama gibi zararsız parametreler korunur — iz sürülebilirlik kaybolmamalı', () => {
      expect(sanitizeUrl('/api/v1/customers?limit=20&query=ayse')).toBe(
        '/api/v1/customers?limit=20&query=ayse',
      );
    });

    it('sorgusuz ve boş URL’lerde patlamaz', () => {
      expect(sanitizeUrl('')).toBe('');
      expect(sanitizeUrl('/healthz')).toBe('/healthz');
    });
  });

  describe('alan bazlı gizleme', () => {
    it('kök seviyedeki sırlar da yollarda tanımlı — `*.password` tek başına yetmez', () => {
      expect(REDACT_PATHS).toContain('password');
      expect(REDACT_PATHS).toContain('*.password');
      expect(REDACT_PATHS).toContain('*.*.password');
    });

    it('telefon maskelenir, diğer sırlar tamamen gizlenir', () => {
      expect(censor('+905321234567', ['req', 'phone'])).toBe(maskPhone('+905321234567'));
      expect(censor('gizli', ['req', 'password'])).toBe('[GİZLENDİ]');
    });

    it('maskeler destek için son iki haneyi ve alan adını bırakır', () => {
      expect(maskPhone('+905321234567')).toBe('+90********67');
      expect(maskEmail('ayse@klinik.com')).toBe('a***e@klinik.com');
    });
  });
});
