import { describe, expect, it } from 'vitest';
import {
  decideOn401,
  FORWARD_REQUEST_HEADERS,
  FORWARD_RESPONSE_HEADERS,
  sanitizeBranchId,
} from '../../src/lib/proxy-headers';

const UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('proxy başlık politikası', () => {
  it('authorization ve cookie İLETİLMİYOR', () => {
    // İstemcinin gönderdiği bir Authorization başlığının geçmesi, proxy'yi bir
    // token yeniden oynatma aracına çevirirdi.
    expect(FORWARD_REQUEST_HEADERS).not.toContain('authorization');
    expect(FORWARD_REQUEST_HEADERS).not.toContain('cookie');
  });

  it('iyimser kilit ve idempotency başlıkları geçiyor', () => {
    expect(FORWARD_REQUEST_HEADERS).toContain('idempotency-key');
    expect(FORWARD_REQUEST_HEADERS).toContain('if-match');
    expect(FORWARD_REQUEST_HEADERS).toContain('if-none-match');
  });

  it('yanıtta x-request-id geri veriliyor — hata paneli onu gösteriyor', () => {
    expect(FORWARD_RESPONSE_HEADERS).toContain('x-request-id');
    expect(FORWARD_RESPONSE_HEADERS).toContain('retry-after');
    expect(FORWARD_RESPONSE_HEADERS).toContain('etag');
  });

  it('yanıt beyaz listesinde set-cookie YOK', () => {
    // Yukarı akış cookie yazmıyor; yazsa bile bizim cookie'lerimizi ezmesine
    // izin vermek istemeyiz.
    expect(FORWARD_RESPONSE_HEADERS).not.toContain('set-cookie');
  });

  it('şube başlığı yalnız UUID biçimindeyse geçiyor', () => {
    expect(sanitizeBranchId(UUID)).toBe(UUID);
    expect(sanitizeBranchId(null)).toBeNull();
    expect(sanitizeBranchId('')).toBeNull();
    expect(sanitizeBranchId('tumu')).toBeNull();
    expect(sanitizeBranchId(`${UUID} OR 1=1`)).toBeNull();
    expect(sanitizeBranchId(`${UUID}\nx-admin: 1`)).toBeNull();
  });
});

describe('401 ayrıştırması', () => {
  it('TOKEN_EXPIRED sessiz yenilemeye gidiyor', () => {
    expect(decideOn401({ code: 'TOKEN_EXPIRED', status: 401 })).toBe('refresh');
  });

  it('TOKEN_INVALID yenilemeyi DENEMİYOR', () => {
    // Yeniden kullanım tespitinin indiği yer. Token zaten yanmış; bir kez daha
    // göndermek sunucuda ikinci bir "yeniden kullanım" kaydı üretir ve istemci
    // sonsuz döngüye girer.
    expect(decideOn401({ code: 'TOKEN_INVALID', status: 401 })).toBe('expired');
    expect(decideOn401({ code: 'UNAUTHENTICATED', status: 401 })).toBe('expired');
  });

  it('bilinmeyen ve okunamayan 401’ler güvenli tarafa düşüyor', () => {
    // Ucuz yön: kullanıcı bir kez daha giriş yapar, oturum ailesi yanmaz.
    expect(decideOn401({ code: 'ACCOUNT_DISABLED', status: 401 })).toBe('expired');
    expect(decideOn401(null)).toBe('expired');
    expect(decideOn401('cop')).toBe('expired');
    expect(decideOn401({})).toBe('expired');
    expect(decideOn401({ code: 42 })).toBe('expired');
  });
});
