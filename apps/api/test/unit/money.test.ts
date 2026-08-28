import { describe, it, expect } from 'vitest';
import { allocateMinor, remainingValueMinor } from '../../src/common/money';

describe('allocateMinor', () => {
  it('kuruş kaybetmez — toplam DAİMA korunur', () => {
    // Naif oranlama burada 1000+1000+1000 = 3000 verir, yani var olmayan bir
    // kuruş yaratır. Paket satışında bu, kalem tahsislerinin toplamının satış
    // fiyatına eşit olmaması demek.
    expect(allocateMinor(2999, [1, 1, 1])).toEqual([1000, 1000, 999]);
    expect(allocateMinor(2999, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(2999);
  });

  it('ağırlıklara göre paylaştırır', () => {
    // 10 lazer (1.500.000) + 2 bakım (100.000) → 1.200.000 satış.
    const shares = allocateMinor(1_200_000, [1_500_000, 100_000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1_200_000);
    expect(shares[0]).toBeGreaterThan(shares[1] ?? 0);
  });

  it('artan kuruşu en büyük kalana verir, eşitlikte düşük indekse', () => {
    expect(allocateMinor(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it('deterministiktir — aynı girdi aynı tahsis', () => {
    const weights = [7, 11, 13, 17];
    expect(allocateMinor(1_000, weights)).toEqual(allocateMinor(1_000, weights));
  });

  it('tüm ağırlıklar sıfırsa parayı KAYBETMEZ', () => {
    expect(allocateMinor(500, [0, 0])).toEqual([500, 0]);
  });

  it('boş liste boş döner, sıfır tutar sıfır paylaştırır', () => {
    expect(allocateMinor(1000, [])).toEqual([]);
    expect(allocateMinor(0, [3, 1])).toEqual([0, 0]);
  });

  it('tamsayı olmayan tutarı ve negatif ağırlığı reddeder', () => {
    expect(() => allocateMinor(10.5, [1])).toThrow(TypeError);
    expect(() => allocateMinor(10, [1, -1])).toThrow(RangeError);
  });
});

describe('remainingValueMinor', () => {
  it('kalan hakkın parasal karşılığını oransal hesaplar', () => {
    // 10 seans / 400.000 → seans başına 40.000.
    expect(remainingValueMinor(400_000, 10, 10)).toBe(400_000);
    expect(remainingValueMinor(400_000, 10, 6)).toBe(240_000);
    expect(remainingValueMinor(400_000, 10, 0)).toBe(0);
  });

  it('yarım-yukarı yuvarlar', () => {
    // 3 seans / 1000 → 1 seans = 333.33… → 333
    expect(remainingValueMinor(1000, 3, 1)).toBe(333);
    // 2 seans / 999 → 1 seans = 499.5 → 500
    expect(remainingValueMinor(999, 2, 1)).toBe(500);
  });

  it('sıfır paydada patlamaz', () => {
    expect(remainingValueMinor(1000, 0, 5)).toBe(0);
  });
});
