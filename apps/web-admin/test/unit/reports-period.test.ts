import { describe, expect, it } from 'vitest';
import {
  localDayIso,
  periodLabel,
  presetRange,
  rangeQuery,
} from '../../src/lib/reports/period';
import {
  formatDelta,
  formatMinutes,
  formatMoney,
  formatPercent,
} from '../../src/lib/reports/format';

/**
 * Dönem dönüşümü raporun en sinsi hata noktası: bir gün eksik ya da fazla, ama
 * grafik yine de makul görünür. Bu yüzden yarı açık aralık (`to` HARİÇ) ile
 * kapsayıcı etiket arasındaki dönüşüm testle sabitleniyor.
 */
describe('dönem ön ayarları', () => {
  // Sabit bir "şimdi": testler makinenin takvimine göre kaymamalı.
  const now = new Date(2026, 8, 15, 14, 30); // 15 Eylül 2026, yerel

  it('bu ay: ayın 1\'inden YARINA kadar', () => {
    const range = presetRange('thisMonth', now);
    expect(range.from.startsWith('2026-09-01T00:00:00')).toBe(true);
    // Bitiş YARIN: `to` hariç olduğu için bugünün başlangıcını vermek bugünü
    // tamamen dışarıda bırakırdı.
    expect(range.to.startsWith('2026-09-16T00:00:00')).toBe(true);
  });

  it('geçen ay tam bir takvim ayı', () => {
    const range = presetRange('lastMonth', now);
    expect(range.from.startsWith('2026-08-01T00:00:00')).toBe(true);
    expect(range.to.startsWith('2026-09-01T00:00:00')).toBe(true);
  });

  it('son 7 gün BUGÜNÜ de kapsıyor', () => {
    const range = presetRange('last7', now);
    expect(range.from.startsWith('2026-09-09T00:00:00')).toBe(true);
    expect(range.to.startsWith('2026-09-16T00:00:00')).toBe(true);
  });

  it('son 30 gün ay sınırını aşabiliyor', () => {
    const range = presetRange('last30', now);
    expect(range.from.startsWith('2026-08-17T00:00:00')).toBe(true);
  });

  it('bu yıl 1 Ocak\'tan başlıyor', () => {
    const range = presetRange('thisYear', now);
    expect(range.from.startsWith('2026-01-01T00:00:00')).toBe(true);
  });

  it('yerel gün UTC\'ye ÇEVRİLMİYOR — offset korunuyor', () => {
    // `toISOString()` kullanılsaydı `+03:00`taki bir kullanıcı için
    // "1 Eylül 00:00" isteği "31 Ağustos 21:00Z" olur ve gönderilen dizgenin
    // görünen günü kullanıcının seçtiğinden farklı olurdu.
    const iso = localDayIso(new Date(2026, 8, 1));
    expect(iso.startsWith('2026-09-01T00:00:00')).toBe(true);
    expect(/[+-]\d{2}:\d{2}$/.test(iso)).toBe(true);
  });

  it('etiket KAPSAYICI — bitiş bir gün geri alınıyor', () => {
    const label = periodLabel({
      from: '2026-09-01T00:00:00+03:00',
      to: '2026-10-01T00:00:00+03:00',
    });
    // Sunucuya "1 Ekim hariç" diyoruz ama kullanıcıya "30 Eylül" göstermeliyiz;
    // aksi hâlde "Eylül raporu" başlığının altında 1 Ekim yazardı.
    expect(label).toContain('30 Eylül 2026');
    expect(label).not.toContain('1 Ekim');
  });

  it('sorgu dizgesinde offset KODLANIYOR', () => {
    const query = rangeQuery({
      from: '2026-09-01T00:00:00+03:00',
      to: '2026-10-01T00:00:00+03:00',
    });
    // Kodlanmayan `+` sunucuda BOŞLUĞA dönüşür ve ISO doğrulaması patlar.
    expect(query).not.toContain('+03:00');
    expect(query).toContain('%2B03%3A00');
  });
});

describe('biçimlendirme', () => {
  it('para kuruştan okunur hâle geliyor', () => {
    expect(formatMoney(123_456)).toContain('1.234,56');
    expect(formatMoney(0)).toContain('0,00');
  });

  it('dakika saate çevriliyor', () => {
    expect(formatMinutes(480)).toBe('8 sa');
    expect(formatMinutes(45)).toBe('45 dk');
    expect(formatMinutes(90)).toBe('1 sa 30 dk');
    expect(formatMinutes(0)).toBe('0 dk');
  });

  it('oran sunucudan geldiği gibi, yalnız işaretleniyor', () => {
    expect(formatPercent(15.63)).toBe('%15,63');
  });

  it('delta `null` iken KIYASLANAMAZ — "%0" değil', () => {
    expect(formatDelta(12.5)).toBe('+12,5%');
    expect(formatDelta(-3)).toBe('-3%');
    // `null`ı "%0" diye göstermek "değişim yok" yalanı olurdu.
    expect(formatDelta(null)).toBeNull();
    expect(formatDelta(undefined)).toBeNull();
  });
});
