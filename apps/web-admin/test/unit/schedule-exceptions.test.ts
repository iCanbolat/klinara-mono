import { describe, expect, it } from 'vitest';
import type { Holiday, ScheduleException } from '@klinara/shared';
import {
  describeException,
  emptyExceptionDraft,
  isPast,
  toExceptionBody,
  validateException,
  type ExceptionDraft,
} from '../../src/lib/schedule/exceptions';
import {
  emptyHolidayDraft,
  splitHolidays,
  toHolidayCreateBody,
  toHolidayPatchBody,
  validateHoliday,
} from '../../src/lib/schedule/holidays';

const TZ = 'Europe/Istanbul';

const draft = (patch: Partial<ExceptionDraft>): ExceptionDraft => ({
  ...emptyExceptionDraft('2026-09-14'),
  staffProfileId: 'p1',
  ...patch,
});

const exception = (patch: Partial<ScheduleException>): ScheduleException => ({
  id: 'e1',
  tenantId: 't1',
  staffProfileId: 'p1',
  branchId: 'b1',
  startsAt: '2026-09-14T00:00:00+03:00',
  endsAt: '2026-09-15T00:00:00+03:00',
  reason: null,
  recurrenceType: 'none',
  recurrenceIntervalWeeks: 1,
  recurrenceUntil: null,
  recurrenceWeekdays: [],
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...patch,
});

describe('izin formu', () => {
  it('tek seferlik tüm gün YARI AÇIK aralık ve tekrar alanları YOK', () => {
    const body = toExceptionBody(draft({ endDate: '2026-09-16', reason: '  Rapor ' }), 'b1', TZ);
    expect(body).toEqual({
      staffProfileId: 'p1',
      branchId: 'b1',
      reason: 'Rapor',
      recurrenceType: 'none',
      startsAt: '2026-09-14T00:00:00+03:00',
      // Bitiş günü DAHİL → ertesi günün 00:00'ı.
      endsAt: '2026-09-17T00:00:00+03:00',
    });
    // Sunucu tek seferlikte bu alanları görürse 400 veriyor.
    expect(body).not.toHaveProperty('recurrenceUntil');
    expect(body).not.toHaveProperty('recurrenceWeekdays');
  });

  it('tek seferlik saatli ve aynı günde bitiş başlangıçtan sonra olmalı', () => {
    const timed = draft({ allDay: false, startTime: '14:00', endTime: '10:00' });
    expect(validateException(timed).endTime).toBe('Bitiş başlangıçtan sonra olmalı.');
    expect(validateException({ ...timed, endDate: '2026-09-15' })).toEqual({});
    expect(toExceptionBody({ ...timed, endDate: '2026-09-15' }, 'b1', TZ)).toEqual(
      expect.objectContaining({ startsAt: '2026-09-14T14:00:00+03:00', endsAt: '2026-09-15T10:00:00+03:00' }),
    );
  });

  it('haftalık: gün, bitiş ve aralık zorunlu', () => {
    const errors = validateException(draft({ kind: 'weekly', intervalWeeks: 0 }));
    expect(errors).toEqual(
      expect.objectContaining({
        weekdays: 'En az bir gün seçin.',
        untilDate: 'Bitiş tarihi zorunlu.',
        intervalWeeks: '1 ile 52 arasında olmalı.',
      }),
    );
  });

  it('özet metinleri', () => {
    expect(describeException(exception({}), TZ)).toBe('14 Eyl 2026 · Tüm gün');
    expect(
      describeException(exception({ endsAt: '2026-09-17T00:00:00+03:00' }), TZ),
    ).toBe('14 Eyl – 16 Eyl 2026 · Tüm gün');
    expect(
      describeException(
        exception({
          recurrenceType: 'weekly',
          startsAt: '2026-09-14T12:00:00+03:00',
          endsAt: '2026-09-14T13:00:00+03:00',
          recurrenceWeekdays: [3, 1],
          recurrenceIntervalWeeks: 2,
          recurrenceUntil: '2026-11-30T23:59:00+03:00',
        }),
        TZ,
      ),
    ).toBe('2 haftada bir Pzt, Çar · 12:00–13:00 · 30 Kas 2026 tarihine kadar');
  });

  it('tekrarlı kayıt bitiş tarihine göre geçmiş sayılıyor', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(isPast(exception({ endsAt: '2026-09-20T00:00:00Z' }), now)).toBe(true);
    expect(
      isPast(exception({ recurrenceType: 'weekly', endsAt: '2026-09-14T13:00:00Z', recurrenceUntil: '2026-12-01T00:00:00Z' }), now),
    ).toBe(false);
  });
});

describe('tatil formu', () => {
  it('tam gün kapalıda saat GÖNDERİLMİYOR; kiracı geneli branchId taşımıyor', () => {
    const base = { ...emptyHolidayDraft(), holidayDate: '2026-10-29', name: ' Cumhuriyet Bayramı ' };
    expect(toHolidayCreateBody(base, 'b1')).toEqual({
      branchId: 'b1',
      holidayDate: '2026-10-29',
      name: 'Cumhuriyet Bayramı',
      isClosed: true,
    });
    expect(toHolidayCreateBody({ ...base, scope: 'tenant' }, 'b1')).not.toHaveProperty('branchId');
  });

  it('PATCH tarih ve kapsam taşımıyor', () => {
    const body = toHolidayPatchBody({ ...emptyHolidayDraft(), holidayDate: '2026-10-29', name: 'X', isClosed: false });
    expect(body).toEqual({ name: 'X', isClosed: false, openTime: '10:00', closeTime: '14:00' });
  });

  it('doğrulama', () => {
    expect(validateHoliday(emptyHolidayDraft())).toEqual({ holidayDate: 'Tarih seçin.', name: 'Ad zorunlu.' });
    expect(
      validateHoliday({ ...emptyHolidayDraft(), holidayDate: '2026-01-01', name: 'a', isClosed: false, closeTime: '09:00' })
        .closeTime,
    ).toBe('Kapanış açılıştan sonra olmalı.');
  });

  it('yaklaşan artan, geçmiş azalan; bugün yaklaşan sayılıyor', () => {
    const h = (id: string, holidayDate: string): Holiday => ({
      id,
      tenantId: 't1',
      branchId: null,
      holidayDate,
      name: id,
      isClosed: true,
      openTime: null,
      closeTime: null,
      createdAt: '',
    });
    const { upcoming, past } = splitHolidays(
      [h('a', '2026-12-31'), h('b', '2026-01-01'), h('c', '2026-09-14'), h('d', '2026-05-19')],
      '2026-09-14',
    );
    expect(upcoming.map((x) => x.id)).toEqual(['c', 'a']);
    expect(past.map((x) => x.id)).toEqual(['d', 'b']);
  });
});
