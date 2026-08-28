import { toZonedIso, zonedDayStart } from '../../common/time';

export interface QuietHoursWindow {
  /** `HH:MM`, şube saat diliminde. */
  start: string;
  end: string;
}

/** `HH:MM` → gün başından itibaren dakika. */
function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(':');
  return Number(hours) * 60 + Number(minutes ?? 0);
}

/** Anın verilen saat dilimindeki yerel tarihi ve dakikası. */
function localParts(instant: Date, timeZone: string): { date: string; minutes: number } {
  const iso = toZonedIso(instant, timeZone);
  return { date: iso.slice(0, 10), minutes: minutesOf(iso.slice(11, 16)) };
}

/**
 * An, sessiz saat penceresinin içinde mi?
 *
 * Pencere GECE YARISINI AŞABİLİR (21:00–09:00) ve tipik hâli budur; bu yüzden
 * `start < end` varsayan basit bir aralık kontrolü yanlış olurdu — gece 23:00
 * "pencerenin dışında" görünür ve mesaj tam da engellemek istediğimiz saatte
 * giderdi.
 */
export function isQuietHour(instant: Date, timeZone: string, window: QuietHoursWindow): boolean {
  const { minutes } = localParts(instant, timeZone);
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * Sessiz saatteki bir anı, pencerenin BİTİŞ saatine öteler.
 *
 * Yaz saati geçişi burada gerçek bir tuzak: yerel gün başlangıcına dakika
 * eklemek, geçiş gününde bir saat kaymış bir sonuç üretir. Bu yüzden sonuç
 * ÖLÇÜLÜP düzeltiliyor — `zonedDayStart`in iki geçişli yaklaşımının aynısı.
 */
export function nextSendableInstant(
  instant: Date,
  timeZone: string,
  window: QuietHoursWindow,
): Date {
  if (!isQuietHour(instant, timeZone, window)) return instant;

  const { date, minutes } = localParts(instant, timeZone);
  const end = minutesOf(window.end);
  const start = minutesOf(window.start);

  // Pencere gece yarısını aşıyorsa ve HÂLÂ sabah tarafındaysak bitiş bugündür;
  // aksi hâlde yarındır.
  const crossesMidnight = start > end;
  const targetDate =
    crossesMidnight && minutes < end ? date : crossesMidnight ? nextDay(date) : date;

  const candidate = new Date(zonedDayStart(targetDate, timeZone).getTime() + end * 60_000);
  const drift = localParts(candidate, timeZone).minutes - end;
  return drift === 0 ? candidate : new Date(candidate.getTime() - drift * 60_000);
}

function nextDay(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
