import { describe, it, expect } from 'vitest';
import type { PublicSlot } from '@klinara/shared';
import {
  addDays,
  daysBetween,
  daysFrom,
  dayKeyOf,
  groupByPart,
  groupSlotsByDay,
  hourOf,
  nextAvailableDay,
  partOfDay,
} from '../../src/components/booking/slot-grouping';

const TZ = 'Europe/Istanbul';

const slot = (startsAt: string): PublicSlot => ({
  startsAt,
  endsAt: startsAt,
  slotToken: startsAt,
});

describe('gün anahtarı — saat dilimi', () => {
  it('UTC ve zonlu biçimi AYNI güne düşürüyor', () => {
    // Faz 11'in 1 numaralı hatası tam olarak buydu: sunucu bir uçta `Z`,
    // başka bir uçta `+03:00` dönüyordu ve aynı slot iki güne ayrılıyordu.
    expect(dayKeyOf('2026-09-07T06:00:00Z', TZ)).toBe('2026-09-07');
    expect(dayKeyOf('2026-09-07T09:00:00+03:00', TZ)).toBe('2026-09-07');
  });

  it('gece yarısı sınırında ŞUBENİN gününü veriyor, ziyaretçininkini değil', () => {
    // 22:30 UTC = ertesi gün 01:30 İstanbul.
    expect(dayKeyOf('2026-09-07T22:30:00Z', TZ)).toBe('2026-09-08');
  });

  it('bozuk tarihte boş dize', () => {
    expect(dayKeyOf('bozuk', TZ)).toBe('');
  });
});

describe('gün aritmetiği', () => {
  it('ay ve yıl sınırını geçiyor', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('yaz saati geçişinde bir günü ATLAMIYOR', () => {
    // Yerel saatte hesaplansaydı 23/25 saatlik gün bir kaymaya yol açardı.
    expect(daysFrom('2026-03-28', 3)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('daysBetween pencere sınırını ölçüyor', () => {
    expect(daysBetween('2026-09-07', '2026-09-14')).toBe(7);
  });

  it('daysFrom yedi gün üretiyor ve BUGÜNE hizalı', () => {
    expect(daysFrom('2026-09-07')).toHaveLength(7);
    expect(daysFrom('2026-09-07')[0]).toBe('2026-09-07');
  });
});

describe('gün bölümü sınırları', () => {
  it('11:59 sabah, 12:00 öğleden sonra', () => {
    expect(partOfDay('2026-09-07T11:59:00+03:00', TZ)).toBe('morning');
    expect(partOfDay('2026-09-07T12:00:00+03:00', TZ)).toBe('afternoon');
  });

  it('16:59 öğleden sonra, 17:00 akşam', () => {
    expect(partOfDay('2026-09-07T16:59:00+03:00', TZ)).toBe('afternoon');
    expect(partOfDay('2026-09-07T17:00:00+03:00', TZ)).toBe('evening');
  });

  it('gece yarısı 24 değil 0 saat', () => {
    // `hour12: false` bazı ICU sürümlerinde `24` üretiyor; `hourCycle: h23` şart.
    expect(hourOf('2026-09-07T00:15:00+03:00', TZ)).toBe(0);
  });

  it('boş bölümler listelenmiyor', () => {
    const groups = groupByPart(
      [slot('2026-09-07T09:00:00+03:00'), slot('2026-09-07T10:00:00+03:00')],
      TZ,
    );
    expect(groups.map((group) => group.part)).toEqual(['morning']);
    expect(groups[0]?.slots).toHaveLength(2);
  });
});

describe('gün gruplama ve sonraki uygun gün', () => {
  const slots = [
    slot('2026-09-07T09:00:00+03:00'),
    slot('2026-09-07T14:00:00+03:00'),
    slot('2026-09-09T18:00:00+03:00'),
  ];

  it('slotları güne göre ayırıyor', () => {
    const byDay = groupSlotsByDay(slots, TZ);
    expect(byDay.get('2026-09-07')).toHaveLength(2);
    expect(byDay.get('2026-09-09')).toHaveLength(1);
    expect(byDay.has('2026-09-08')).toBe(false);
  });

  it('sonraki uygun günü EK İSTEK OLMADAN buluyor', () => {
    const byDay = groupSlotsByDay(slots, TZ);
    expect(nextAvailableDay(byDay, '2026-09-08')).toBe('2026-09-09');
    // `from` DAHİL.
    expect(nextAvailableDay(byDay, '2026-09-07')).toBe('2026-09-07');
    expect(nextAvailableDay(byDay, '2026-09-10')).toBeNull();
  });
});
