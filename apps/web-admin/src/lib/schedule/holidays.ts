/**
 * Tatil formu ve listesi — saf.
 *
 * `holidayDate` bir GÜN (`YYYY-MM-DD`), an değil: saat dilimine göre
 * çevrilmiyor. Biçimleme UTC'de yapılıyor ki negatif ofsetli bir tarayıcıda
 * bir gün geriye kaymasın (bkz. `calendar/date.ts#formatDayLabel`).
 */
import type { Holiday } from '@klinara/shared';
import type { DayKey } from '@/lib/calendar/date';
import { parseTime, toHm } from './entries';

export type HolidayScope = 'branch' | 'tenant';

export interface HolidayDraft {
  holidayDate: DayKey;
  name: string;
  scope: HolidayScope;
  isClosed: boolean;
  openTime: string;
  closeTime: string;
}

export function emptyHolidayDraft(): HolidayDraft {
  return { holidayDate: '', name: '', scope: 'branch', isClosed: true, openTime: '10:00', closeTime: '14:00' };
}

export function draftFromHoliday(holiday: Holiday): HolidayDraft {
  return {
    holidayDate: holiday.holidayDate,
    name: holiday.name,
    scope: holiday.branchId === null ? 'tenant' : 'branch',
    isClosed: holiday.isClosed,
    openTime: toHm(holiday.openTime) ?? '10:00',
    closeTime: toHm(holiday.closeTime) ?? '14:00',
  };
}

export type HolidayErrors = Partial<Record<keyof HolidayDraft, string>>;

export function validateHoliday(draft: HolidayDraft): HolidayErrors {
  const errors: HolidayErrors = {};
  if (draft.holidayDate === '') errors.holidayDate = 'Tarih seçin.';
  if (draft.name.trim() === '') errors.name = 'Ad zorunlu.';
  else if (draft.name.trim().length > 200) errors.name = 'En fazla 200 karakter.';
  if (!draft.isClosed) {
    const open = parseTime(draft.openTime);
    const close = parseTime(draft.closeTime);
    if (open === null) errors.openTime = 'Saat seçin.';
    if (close === null) errors.closeTime = 'Saat seçin.';
    if (open !== null && close !== null && close <= open) {
      errors.closeTime = 'Kapanış açılıştan sonra olmalı.';
    }
  }
  return errors;
}

/** Yarım gün değilse saat alanları GÖNDERİLMİYOR (sunucu tutarsızlığa 400 verir). */
function hoursPart(draft: HolidayDraft): { isClosed: boolean; openTime?: string; closeTime?: string } {
  return draft.isClosed
    ? { isClosed: true }
    : { isClosed: false, openTime: draft.openTime, closeTime: draft.closeTime };
}

export function toHolidayCreateBody(draft: HolidayDraft, branchId: string) {
  return {
    ...(draft.scope === 'branch' ? { branchId } : {}),
    holidayDate: draft.holidayDate,
    name: draft.name.trim(),
    ...hoursPart(draft),
  };
}

/** ⚠️ `PATCH` tarihi ve şubeyi DEĞİŞTİRMİYOR; gövdede de yoklar. */
export function toHolidayPatchBody(draft: HolidayDraft) {
  return { name: draft.name.trim(), ...hoursPart(draft) };
}

/** Yaklaşan (bugün dahil) artan, geçmiş azalan sırada. */
export function splitHolidays(
  holidays: readonly Holiday[],
  today: DayKey,
): { upcoming: Holiday[]; past: Holiday[] } {
  const upcoming = holidays
    .filter((holiday) => holiday.holidayDate >= today)
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
  const past = holidays
    .filter((holiday) => holiday.holidayDate < today)
    .sort((a, b) => b.holidayDate.localeCompare(a.holidayDate));
  return { upcoming, past };
}

/** `{ day: '23', month: 'Nis', weekday: 'Perşembe', year: '2026' }` — tarih rozeti. */
export function holidayDateParts(key: DayKey): { day: string; month: string; weekday: string; year: string } {
  const [y, m, d] = key.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const format = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', ...options }).format(date);
  return {
    day: format({ day: 'numeric' }),
    month: format({ month: 'short' }),
    weekday: format({ weekday: 'long' }),
    year: format({ year: 'numeric' }),
  };
}
