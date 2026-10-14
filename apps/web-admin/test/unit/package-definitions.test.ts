import { describe, expect, it } from 'vitest';
import {
  discountMinor,
  discountPercent,
  itemsSummary,
  listTotalMinor,
  slugify,
  totalSessions,
} from '../../src/lib/catalog/package-definitions';

describe('paket tanımı hesapları', () => {
  const items = [
    { quantity: 10, unitListPriceMinor: 50000 },
    { quantity: 2, unitListPriceMinor: 30000 },
  ];

  it('seans ve katalog toplamı', () => {
    expect(totalSessions(items)).toBe(12);
    expect(listTotalMinor(items)).toBe(560000);
  });

  it('indirim yalnız pozitifse', () => {
    expect(discountMinor(560000, 500000)).toBe(60000);
    expect(discountMinor(560000, 560000)).toBeNull();
    expect(discountMinor(560000, 600000)).toBeNull();
    expect(discountMinor(560000, null)).toBeNull();
    expect(discountPercent(500000, 400000)).toBe(20);
    expect(discountPercent(0, 0)).toBeNull();
  });

  it('kalem özeti sıralı', () => {
    expect(
      itemsSummary([
        { id: 'b', serviceId: 's2', serviceName: 'Bakım', quantity: 2, unitListPriceMinor: 1, sortOrder: 1 },
        { id: 'a', serviceId: 's1', serviceName: 'Lazer', quantity: 10, unitListPriceMinor: 1, sortOrder: 0 },
      ]),
    ).toBe('10× Lazer, 2× Bakım');
  });

  it('Türkçe slug', () => {
    expect(slugify('10 Seans Lazer + 2 Bakım')).toBe('10-seans-lazer-2-bakim');
    expect(slugify('  Işıl Çağ Güzelliği  ')).toBe('isil-cag-guzelligi');
    expect(slugify('---')).toBe('');
  });
});
