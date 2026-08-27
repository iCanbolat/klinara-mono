/**
 * Zaman biçimlendirme — API sözleşmesi 5.8.
 *
 * Sunucu her şeyi UTC saklar ama yanıtta zamanı ŞUBENİN saat diliminde,
 * offset'iyle döndürür (`2026-09-01T14:00:00+03:00`). Sebebi kozmetik değil:
 * istemci "bu randevu klinikte saat kaçta?" sorusunu cihazın saat dilimine
 * bakmadan cevaplayabilmelidir — telefonu başka bir ülkede olan bir yönetici
 * de aynı takvimi görür.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // `hourCycle: 'h23'` şart: bazı ICU sürümleri `hour12: false` ile geceyarısını
    // "24" olarak üretir ve tarih bir gün kayar.
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * Anı verilen IANA saat diliminde, offset'li ISO 8601 metnine çevirir.
 *
 * Offset ANLIK olarak hesaplanır (`longOffset`), sabit bir değer varsayılmaz —
 * yaz saati uygulayan bir şubede aynı yerel saat yılın yarısında `+01:00`,
 * yarısında `+02:00` döner ve ikisi de doğrudur.
 */
export function toZonedIso(instant: Date, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const zoneName = get('timeZoneName');
  // "GMT+03:00" → "+03:00", "GMT+3" → "+03:00", düz "GMT" → "Z".
  const offset = zoneName === 'GMT' ? 'Z' : normalizeOffset(zoneName.replace('GMT', ''));

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

function normalizeOffset(raw: string): string {
  if (raw.length === 0) return 'Z';
  const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (match === null) return 'Z';
  const [, sign, hours, minutes] = match;
  return `${sign}${(hours ?? '0').padStart(2, '0')}:${minutes ?? '00'}`;
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const iso = toZonedIso(instant, timeZone);
  const zone = iso.slice(19);
  if (zone === 'Z') return 0;
  const sign = zone.startsWith('-') ? -1 : 1;
  const [hours, minutes] = zone.slice(1).split(':');
  return sign * (Number(hours) * 60 + Number(minutes ?? 0));
}

/**
 * Verilen YEREL tarihin (YYYY-MM-DD) o saat dilimindeki başlangıç anı.
 *
 * Takvim uçları "7 Eylül günü" gibi yerel bir kavramla çalışır; veritabanı ise
 * anlarla. Dönüşüm iki adımlıdır çünkü offset'in kendisi ana bağlıdır: ilk
 * tahminle bulunan offset, yaz saati geçiş günlerinde sonucun düştüğü offset'ten
 * farklı olabilir. İkinci geçiş bunu düzeltir.
 */
export function zonedDayStart(localDate: string, timeZone: string): Date {
  const utcMidnight = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(utcMidnight.getTime())) {
    throw new Error(`Geçersiz tarih: ${localDate}`);
  }

  const firstGuess = new Date(utcMidnight.getTime() - offsetMinutes(utcMidnight, timeZone) * 60_000);
  const corrected = new Date(utcMidnight.getTime() - offsetMinutes(firstGuess, timeZone) * 60_000);
  return corrected;
}

/** Yerel günün [başlangıç, bitiş) aralığı — `dayCount` gün ileriye. */
export function zonedDayRange(
  localDate: string,
  timeZone: string,
  dayCount = 1,
): { from: Date; to: Date } {
  const from = zonedDayStart(localDate, timeZone);
  const endDate = new Date(`${localDate}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + dayCount);
  const to = zonedDayStart(endDate.toISOString().slice(0, 10), timeZone);
  return { from, to };
}
