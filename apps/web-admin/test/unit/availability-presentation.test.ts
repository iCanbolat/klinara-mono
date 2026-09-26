import { describe, expect, it } from 'vitest';
import type { AvailabilityDay, AvailabilitySlot } from '@klinara/shared';
import {
  emptyDayNotice,
  groupSlots,
  openDayNote,
  unavailableDayLabel,
} from '@/lib/calendar/availability';

const TZ = 'Europe/Istanbul';
const slot = (hhmm: string): AvailabilitySlot => ({
  startsAt: `2026-09-29T${hhmm}:00+03:00`,
  endsAt: `2026-09-29T${hhmm}:00+03:00`,
  staffProfileIds: ['p1'],
});
const day = (overrides: Partial<AvailabilityDay>): AvailabilityDay => ({
  date: '2026-09-29',
  status: 'open',
  holidayName: null,
  opensAt: '09:00',
  closesAt: '18:00',
  ...overrides,
});

describe('uygunluk sunumu', () => {
  it('slotları şube saatine göre sabah / öğleden sonra / akşam gruplar', () => {
    const groups = groupSlots(
      [slot('09:00'), slot('11:45'), slot('12:00'), slot('16:45'), slot('17:00')],
      TZ,
    );
    expect(groups.map((group) => [group.period, group.slots.length])).toEqual([
      ['morning', 2],
      ['afternoon', 2],
      ['evening', 1],
    ]);
  });

  it('gruplama tarayıcının değil ŞUBENİN saat dilimini kullanır', () => {
    // 09:00 İstanbul = 06:00 UTC; UTC'ye göre gruplasaydı yine sabah olurdu,
    // bu yüzden akşamı sınıyoruz: 17:30 İstanbul = 14:30 UTC (öğleden sonra).
    expect(groupSlots([slot('17:30')], TZ)[0]?.period).toBe('evening');
  });

  it('boş listenin nedeni gün durumundan gelir', () => {
    expect(emptyDayNotice(day({ status: 'holiday', holidayName: 'Bayram' })).title).toBe(
      'Tatil · Bayram',
    );
    expect(emptyDayNotice(day({ status: 'closed' })).title).toBe('Şube bu gün kapalı');
    expect(emptyDayNotice(day({ status: 'past' })).tone).toBe('info');
    expect(emptyDayNotice(day({ status: 'open' }))).toMatchObject({
      tone: 'empty',
      title: 'Bu gün boş saat kalmadı',
    });
    // Eski API (`days` yok) → dolu kabul.
    expect(emptyDayNotice(undefined).tone).toBe('empty');
  });

  it('yarım gün tatil açık günde not olarak görünür', () => {
    expect(
      openDayNote(day({ holidayName: 'Arife', opensAt: '09:00', closesAt: '13:00' })),
    ).toBe('Arife · kısaltılmış çalışma saatleri 09:00–13:00');
    expect(openDayNote(day({}))).toBeNull();
  });

  it('tarih seçici yalnız açık OLMAYAN günleri kapatır', () => {
    expect(unavailableDayLabel(day({}))).toBeNull();
    expect(unavailableDayLabel(day({ status: 'closed' }))).toBe('Kapalı');
    expect(unavailableDayLabel(day({ status: 'holiday', holidayName: 'Bayram' }))).toBe('Bayram');
  });
});
