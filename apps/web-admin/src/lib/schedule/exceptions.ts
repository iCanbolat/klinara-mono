/**
 * İzin / istisna formu ↔ API gövdesi — saf.
 *
 * ---------------------------------------------------------------------------
 * TEKRARLAYAN İZİN NASIL YORUMLANIYOR
 * ---------------------------------------------------------------------------
 * Uygunluk motoru (`availability.repository.ts`) haftalık kayıtta her seçili
 * günde `startsAt`in YEREL SAATİNDE başlayan ve `endsAt - startsAt` süren bir
 * blok üretiyor; hafta sayımı `startsAt`in haftasından başlıyor. Yani
 * `startsAt`/`endsAt` "ilk oluşum", süre de bir günü aşmamalı. Form bunu
 * "ilk gün + saat aralığı + günler + her N hafta + bitiş" olarak soruyor.
 *
 * Saatler ŞUBE saat diliminde kuruluyor (`localIsoAt`), tarayıcınınkinde
 * değil: yurt dışından giren bir yönetici izni saatlerce kaydırırdı.
 */
import type { ScheduleException } from '@klinara/shared';
import { addDays, dayKeyOf, localIsoAt, type DayKey } from '@/lib/calendar/date';
import { parseTime, WEEKDAY_ORDER, WEEKDAY_SHORT } from './entries';

export type ExceptionKind = 'once' | 'weekly';

export interface ExceptionDraft {
  staffProfileId: string;
  kind: ExceptionKind;
  /** Tek seferlik: tüm gün mü (saat alanları yok sayılır). */
  allDay: boolean;
  /** `YYYY-MM-DD`. Tek seferlikte başlangıç günü; haftalıkta ilk gün. */
  startDate: DayKey;
  /** Tek seferlikte bitiş günü (dahil). Haftalıkta kullanılmıyor. */
  endDate: DayKey;
  /** `HH:MM`. */
  startTime: string;
  endTime: string;
  weekdays: number[];
  intervalWeeks: number;
  /** Haftalık: son gün (dahil). */
  untilDate: DayKey;
  reason: string;
}

export function emptyExceptionDraft(today: DayKey): ExceptionDraft {
  return {
    staffProfileId: '',
    kind: 'once',
    allDay: true,
    startDate: today,
    endDate: today,
    startTime: '09:00',
    endTime: '18:00',
    weekdays: [],
    intervalWeeks: 1,
    untilDate: '',
    reason: '',
  };
}

export type ExceptionErrors = Partial<Record<keyof ExceptionDraft, string>>;

export function validateException(draft: ExceptionDraft): ExceptionErrors {
  const errors: ExceptionErrors = {};
  if (draft.staffProfileId === '') errors.staffProfileId = 'Personel seçin.';
  if (draft.startDate === '') errors.startDate = 'Tarih seçin.';

  const timed = draft.kind === 'weekly' || !draft.allDay;
  if (timed) {
    const start = parseTime(draft.startTime);
    const end = parseTime(draft.endTime);
    if (start === null) errors.startTime = 'Saat seçin.';
    if (end === null) errors.endTime = 'Saat seçin.';
    if (draft.kind === 'weekly' && start !== null && end !== null && end <= start) {
      errors.endTime = 'Bitiş başlangıçtan sonra olmalı.';
    }
  }

  if (draft.kind === 'once') {
    if (draft.endDate === '') errors.endDate = 'Tarih seçin.';
    else if (draft.startDate !== '' && draft.endDate < draft.startDate) {
      errors.endDate = 'Bitiş başlangıçtan önce olamaz.';
    } else if (
      !draft.allDay &&
      draft.endDate === draft.startDate &&
      errors.startTime === undefined &&
      errors.endTime === undefined &&
      (parseTime(draft.endTime) ?? 0) <= (parseTime(draft.startTime) ?? 0)
    ) {
      errors.endTime = 'Bitiş başlangıçtan sonra olmalı.';
    }
  } else {
    if (draft.weekdays.length === 0) errors.weekdays = 'En az bir gün seçin.';
    if (!Number.isInteger(draft.intervalWeeks) || draft.intervalWeeks < 1 || draft.intervalWeeks > 52) {
      errors.intervalWeeks = '1 ile 52 arasında olmalı.';
    }
    if (draft.untilDate === '') errors.untilDate = 'Bitiş tarihi zorunlu.';
    else if (draft.startDate !== '' && draft.untilDate < draft.startDate) {
      errors.untilDate = 'Bitiş ilk günden önce olamaz.';
    }
  }

  return errors;
}

export interface ExceptionBody {
  staffProfileId: string;
  branchId: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
  recurrenceType: 'none' | 'weekly';
  recurrenceIntervalWeeks?: number;
  recurrenceUntil?: string;
  recurrenceWeekdays?: number[];
}

/**
 * Formu gövdeye çevirir. ÖNCE `validateException` boş dönmüş olmalı.
 *
 * Tek seferlik tüm gün: `[startDate 00:00, endDate+1 00:00)` — yarı açık
 * aralık; bitişi 23:59 yapmak son dakikayı açıkta bırakırdı.
 *
 * ⚠️ Sunucu tek seferlik kayıtta `recurrenceUntil`/`recurrenceWeekdays`
 * görürse 400 veriyor; o alanlar hiç gönderilmiyor.
 */
export function toExceptionBody(
  draft: ExceptionDraft,
  branchId: string,
  timeZone: string,
): ExceptionBody {
  const reason = draft.reason.trim();
  const base = {
    staffProfileId: draft.staffProfileId,
    branchId,
    ...(reason === '' ? {} : { reason }),
  };
  const start = parseTime(draft.startTime) ?? 0;
  const end = parseTime(draft.endTime) ?? 0;

  if (draft.kind === 'once') {
    return draft.allDay
      ? {
          ...base,
          recurrenceType: 'none',
          startsAt: localIsoAt(draft.startDate, 0, timeZone),
          endsAt: localIsoAt(addDays(draft.endDate, 1), 0, timeZone),
        }
      : {
          ...base,
          recurrenceType: 'none',
          startsAt: localIsoAt(draft.startDate, start, timeZone),
          endsAt: localIsoAt(draft.endDate, end, timeZone),
        };
  }

  return {
    ...base,
    recurrenceType: 'weekly',
    startsAt: localIsoAt(draft.startDate, start, timeZone),
    endsAt: localIsoAt(draft.startDate, end, timeZone),
    recurrenceIntervalWeeks: draft.intervalWeeks,
    // Bitiş günü DAHİL: motor `recurrence_until`un gününe kadar üretiyor;
    // günün sonunu göndermek o günü de kapsıyor.
    recurrenceUntil: localIsoAt(draft.untilDate, 23 * 60 + 59, timeZone),
    recurrenceWeekdays: WEEKDAY_ORDER.filter((day) => draft.weekdays.includes(day)),
  };
}

/** Liste bölümü: sürüyor/yaklaşan önce, biten sonra. */
export function isPast(exception: ScheduleException, now: Date): boolean {
  const end = exception.recurrenceType === 'weekly' ? exception.recurrenceUntil : exception.endsAt;
  return end !== null && new Date(end).getTime() <= now.getTime();
}

/** Kayıt şu an sürüyor mu (yalnız tek seferlik için anlamlı). */
export function isOngoing(exception: ScheduleException, now: Date): boolean {
  if (exception.recurrenceType !== 'none') return false;
  const ms = now.getTime();
  return new Date(exception.startsAt).getTime() <= ms && new Date(exception.endsAt).getTime() > ms;
}

/**
 * İnsan okur özet.
 * - Tek seferlik tüm gün:  `14 Eyl – 16 Eyl 2026 · Tüm gün`
 * - Tek seferlik saatli:   `14 Eyl 2026 10:00 – 14:00`
 * - Haftalık:              `Her hafta Pzt, Çar · 12:00–13:00 · 30 Kas 2026'e kadar`
 */
export function describeException(exception: ScheduleException, timeZone: string): string {
  const date = new Intl.DateTimeFormat('tr-TR', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
  const shortDate = new Intl.DateTimeFormat('tr-TR', { timeZone, day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const starts = new Date(exception.startsAt);
  const ends = new Date(exception.endsAt);

  if (exception.recurrenceType === 'weekly') {
    const days = WEEKDAY_ORDER.filter((day) => exception.recurrenceWeekdays.includes(day))
      .map((day) => WEEKDAY_SHORT[day])
      .join(', ');
    const every =
      exception.recurrenceIntervalWeeks > 1 ? `${exception.recurrenceIntervalWeeks} haftada bir` : 'Her hafta';
    const until =
      exception.recurrenceUntil === null ? '' : ` · ${date.format(new Date(exception.recurrenceUntil))} tarihine kadar`;
    return `${every} ${days} · ${time.format(starts)}–${time.format(ends)}${until}`;
  }

  const startKey = dayKeyOf(exception.startsAt, timeZone);
  const endKey = dayKeyOf(exception.endsAt, timeZone);
  const startMinutes = time.format(starts);
  const endMinutes = time.format(ends);
  const allDay = startMinutes === '00:00' && endMinutes === '00:00';

  if (allDay) {
    const lastKey = addDays(endKey, -1);
    if (lastKey === startKey) return `${date.format(starts)} · Tüm gün`;
    const last = new Date(ends.getTime() - 1);
    return `${shortDate.format(starts)} – ${date.format(last)} · Tüm gün`;
  }
  if (startKey === endKey) return `${date.format(starts)} · ${startMinutes}–${endMinutes}`;
  return `${shortDate.format(starts)} ${startMinutes} – ${date.format(ends)} ${endMinutes}`;
}
