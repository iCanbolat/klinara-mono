/** Müşteri kartındaki tarih gösterimleri — tek yerde, tek biçim. */

const DATE = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const TIME = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

/**
 * `YYYY-MM-DD` takvim günü. `new Date('1990-05-01')` UTC gece yarısıdır ve
 * UTC'nin batısındaki bir tarayıcıda bir önceki güne düşer; gün yerel olarak
 * kuruluyor.
 */
export function formatCalendarDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (year === undefined || month === undefined || date === undefined) return day;
  return DATE.format(new Date(year, month - 1, date));
}

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** `1_234_567` → `1,2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}
