import { describe, it, expect } from 'vitest';
import {
  allocateMinor,
  applyDiscount,
  remainingValueMinor,
  roundHalfEven,
  splitVatInclusive,
} from '../../src/common/money';

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

describe('roundHalfEven', () => {
  it('yarımı ÇİFTE çeker — sistematik sapma birikmez', () => {
    expect(roundHalfEven(5, 2)).toBe(2); // 2,5 → 2
    expect(roundHalfEven(7, 2)).toBe(4); // 3,5 → 4
    expect(roundHalfEven(9, 2)).toBe(4); // 4,5 → 4
    expect(roundHalfEven(11, 2)).toBe(6); // 5,5 → 6
  });

  it('yarım olmayanları normal yuvarlar', () => {
    expect(roundHalfEven(4, 3)).toBe(1); // 1,33
    expect(roundHalfEven(5, 3)).toBe(2); // 1,66
  });

  it('negatif değerlerde de yarımı çifte çeker', () => {
    expect(roundHalfEven(-5, 2)).toBe(-2); // -2,5 → -2
    expect(roundHalfEven(-7, 2)).toBe(-4); // -3,5 → -4
  });

  it('negatif payda ve sıfır payda', () => {
    expect(roundHalfEven(5, -2)).toBe(-2);
    expect(() => roundHalfEven(1, 0)).toThrow(RangeError);
    expect(() => roundHalfEven(1.5, 2)).toThrow(TypeError);
  });
});

describe('splitVatInclusive', () => {
  it('KDV brütün İÇİNDEN çıkar; net + KDV daima brüte eşittir', () => {
    // 120,00 TL brüt, %20 → 100,00 net + 20,00 KDV.
    expect(splitVatInclusive(12_000, 2000)).toEqual({ netMinor: 10_000, vatMinor: 2_000 });
  });

  it('kuruş kaybı yok — rastgele tutar/oran kombinasyonlarında toplam korunur', () => {
    for (const total of [1, 7, 99, 12_345, 999_999, 1_000_000]) {
      for (const rate of [0, 100, 800, 1000, 1800, 2000]) {
        const { netMinor, vatMinor } = splitVatInclusive(total, rate);
        expect(netMinor + vatMinor).toBe(total);
      }
    }
  });

  it('negatif tutarda (iade) da toplamı korur', () => {
    const { netMinor, vatMinor } = splitVatInclusive(-12_000, 2000);
    expect(netMinor + vatMinor).toBe(-12_000);
    expect(vatMinor).toBe(-2_000);
  });

  it('sıfır oranda KDV üretmez', () => {
    expect(splitVatInclusive(50_000, 0)).toEqual({ netMinor: 50_000, vatMinor: 0 });
  });
});

describe('applyDiscount', () => {
  it('yüzde indirimini baz puandan hesaplar', () => {
    expect(applyDiscount(100_000, 'percent', 1500)).toBe(15_000);
    expect(applyDiscount(100_000, 'percent', 10_000)).toBe(100_000);
  });

  it('tutar indirimini olduğu gibi uygular', () => {
    expect(applyDiscount(100_000, 'amount', 25_000)).toBe(25_000);
  });

  it('TABANI AŞAMAZ — indirim sonrası tutar negatife düşemez', () => {
    expect(applyDiscount(10_000, 'amount', 500_000)).toBe(10_000);
  });

  it('negatif değerleri reddeder', () => {
    expect(() => applyDiscount(-1, 'amount', 1)).toThrow(RangeError);
    expect(() => applyDiscount(1, 'amount', -1)).toThrow(RangeError);
  });
});
