import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type ProblemDetails } from '@klinara/shared';
import { describeProblem, isProblem, networkError } from '../../src/lib/problem';

function problem(overrides: Partial<ProblemDetails>): ProblemDetails {
  return {
    type: 'https://errors.klinara.app/x',
    title: 'Sunucu başlığı',
    status: 400,
    code: 'X',
    instance: '/api/v1/x',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('problem belgesi tanıma', () => {
  it('yalnız code + status taşıyan nesneler problem sayılıyor', () => {
    expect(isProblem(problem({}))).toBe(true);
    expect(isProblem({ code: 'X' })).toBe(false);
    expect(isProblem({ status: 400 })).toBe(false);
    expect(isProblem(null)).toBe(false);
    expect(isProblem('hata')).toBe(false);
  });
});

describe('kullanıcıya gösterilecek metin', () => {
  it('bilinen kodlarda KENDİ metnimiz kullanılıyor', () => {
    // Sunucunun metni geliştiriciye yazılmış olabilir; bildiğimiz kodlarda
    // kullanıcıya uygun olanı biz veriyoruz.
    expect(describeProblem(problem({ code: ERROR_CODES.FORBIDDEN })).message).toBe(
      'Bu işlem için yetkiniz yok.',
    );
    expect(describeProblem(problem({ code: ERROR_CODES.INVALID_CREDENTIALS })).message).toBe(
      'E-posta veya parola hatalı.',
    );
  });

  it('HOST_TAKEN başka hiçbir bilgi VERMİYOR', () => {
    // API hangi hesabın kullandığını kasıtla söylemiyor; arayüz bunu geri
    // almamalı.
    const described = describeProblem(
      problem({ code: ERROR_CODES.HOST_TAKEN, detail: 'tenant abc tarafından kullanılıyor' }),
    );
    expect(described.message).toBe('Bu alan adı başka bir hesapta kullanılıyor.');
    expect(described.message).not.toContain('abc');
  });

  it('bilinmeyen kodda sunucunun metnine düşülüyor', () => {
    // Yeni bir hata kodu eklendiğinde kullanıcı boş kutu görmemeli.
    expect(describeProblem(problem({ code: 'YEPYENI', detail: 'Ayrıntı' })).message).toBe('Ayrıntı');
    expect(describeProblem(problem({ code: 'YEPYENI', title: 'Başlık' })).message).toBe('Başlık');
  });

  it('hız sınırında bekleme süresi metne giriyor', () => {
    const described = describeProblem(problem({ code: ERROR_CODES.RATE_LIMITED }), 30);
    expect(described.message).toContain('30');
    expect(described.retryAfterSeconds).toBe(30);
  });

  it('Retry-After yoksa hız sınırı metni sayı UYDURMUYOR', () => {
    const described = describeProblem(problem({ code: ERROR_CODES.RATE_LIMITED, title: 'Çok istek' }));
    expect(described.message).toBe('Çok istek');
  });

  it('oturum sonu yalnız TOKEN_INVALID ve UNAUTHENTICATED için işaretleniyor', () => {
    expect(describeProblem(problem({ code: ERROR_CODES.TOKEN_INVALID })).sessionEnded).toBe(true);
    expect(describeProblem(problem({ code: ERROR_CODES.UNAUTHENTICATED })).sessionEnded).toBe(true);
    // TOKEN_EXPIRED sessizce yenilenir; kullanıcıya modal açmak yanlış olurdu.
    expect(describeProblem(problem({ code: ERROR_CODES.TOKEN_EXPIRED })).sessionEnded).toBe(false);
    expect(describeProblem(problem({ code: ERROR_CODES.FORBIDDEN })).sessionEnded).toBe(false);
  });

  it('alan hataları ve requestId taşınıyor', () => {
    const described = describeProblem(
      problem({
        code: ERROR_CODES.VALIDATION_FAILED,
        errors: [{ path: 'host', message: 'Geçersiz' }],
      }),
    );
    expect(described.fieldErrors).toEqual([{ path: 'host', message: 'Geçersiz' }]);
    expect(described.requestId).toBe('req-1');
  });

  it('boş requestId null’a çevriliyor', () => {
    expect(describeProblem(problem({ requestId: '' })).requestId).toBeNull();
  });

  it('ağ hatasının kendi metni var', () => {
    expect(networkError().message).toContain('Sunucuya ulaşılamadı');
    expect(networkError().sessionEnded).toBe(false);
  });
});
