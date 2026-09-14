import { describe, expect, it } from 'vitest';
import type { CalendarEntry } from '@klinara/shared';
import {
  densityMap,
  gridWindow,
  groupByDay,
  positionEntries,
  windowHours,
} from '../../src/lib/calendar/grid';

const entry = (id: string, startsAt: string, endsAt: string): CalendarEntry => ({
  id,
  branchId: 'b1',
  customerId: 'c1',
  customerName: id,
  customerPhone: null,
  status: 'scheduled',
  startsAt,
  endsAt,
  notes: null,
  version: 1,
  totalMinor: 0,
  services: [],
});

describe('ızgara konumlandırma', () => {
  it('dakikaları ŞUBE saat diliminde hesaplıyor ve çakışanları yan yana diziyor', () => {
    const rows = positionEntries(
      [
        entry('a', '2026-09-07T10:00:00+03:00', '2026-09-07T11:00:00+03:00'),
        entry('b', '2026-09-07T10:30:00+03:00', '2026-09-07T11:30:00+03:00'),
      ],
      'Europe/Istanbul',
    );
    expect(rows.map((row) => [row.entry.id, row.startMin, row.lane, row.laneCount])).toEqual([
      ['a', 600, 0, 2],
      ['b', 630, 1, 2],
    ]);
  });

  it('gece yarısını aşan randevunun bitişi gün sonuna sabitleniyor', () => {
    const [row] = positionEntries(
      [entry('late', '2026-09-07T23:00:00+03:00', '2026-09-08T00:30:00+03:00')],
      'Europe/Istanbul',
    );
    expect(row?.endMin).toBe(24 * 60);
  });

  it('pencere taban 08–20, taşan randevuda tam saate yuvarlanarak genişliyor', () => {
    expect(gridWindow([])).toEqual({ start: 480, end: 1200 });
    expect(gridWindow([{ startMin: 7 * 60 + 15, endMin: 21 * 60 + 10 }])).toEqual({
      start: 420,
      end: 1320,
    });
    expect(windowHours({ start: 480, end: 600 })).toEqual([480, 540, 600]);
  });
});

describe('güne göre gruplama', () => {
  it('günü tarayıcıya değil ŞUBE saat dilimine göre seçiyor', () => {
    // UTC'de 6 Eylül 22:30 — İstanbul'da 7 Eylül 01:30.
    const late = entry('x', '2026-09-06T22:30:00Z', '2026-09-06T23:00:00Z');
    const groups = groupByDay([late], 'Europe/Istanbul', ['2026-09-06', '2026-09-07']);
    expect(groups.get('2026-09-06')).toEqual([]);
    expect(groups.get('2026-09-07')?.map((e) => e.id)).toEqual(['x']);
  });

  it('gün içinde başlangıca göre sıralıyor, aralık dışını atıyor', () => {
    const groups = groupByDay(
      [
        entry('late', '2026-09-07T15:00:00+03:00', '2026-09-07T16:00:00+03:00'),
        entry('early', '2026-09-07T09:00:00+03:00', '2026-09-07T10:00:00+03:00'),
        entry('other', '2026-09-09T09:00:00+03:00', '2026-09-09T10:00:00+03:00'),
      ],
      'Europe/Istanbul',
      ['2026-09-07'],
    );
    expect([...groups.keys()]).toEqual(['2026-09-07']);
    expect(groups.get('2026-09-07')?.map((e) => e.id)).toEqual(['early', 'late']);
  });
});

describe('yoğunluk', () => {
  it('aynı gün-saat kovalarını topluyor ve tepe değeri buluyor', () => {
    const { counts, peak } = densityMap([
      { localDay: '2026-09-07', localHour: 10, appointmentCount: 2 },
      { localDay: '2026-09-07', localHour: 10, appointmentCount: 1 },
      { localDay: '2026-09-08', localHour: 11, appointmentCount: 2 },
    ]);
    expect(counts.get('2026-09-07|10')).toBe(3);
    expect(peak).toBe(3);
  });
});
