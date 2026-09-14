/**
 * Takvim ekranının tarih katmanı — sıfır bağımlılık, tamamı saf.
 *
 * ---------------------------------------------------------------------------
 * NEDEN KÜTÜPHANE YOK
 * ---------------------------------------------------------------------------
 * Buradaki problem "tarih aritmetiği" değil, ŞUBE SAAT DİLİMİ. API her takvim
 * ve uygunluk yanıtında `timezone` döndürüyor ve tüm anlar offsetli ISO.
 * Kullanıcının tarayıcısının saat dilimi İLGİSİZDİR: İstanbul şubesinin
 * takvimini Berlin'den açan bir yönetici İstanbul günlerini görmeli.
 *
 * `date-fns` çekirdeği tamamen tarayıcı-yereldir ve bu problemi çözmez;
 * `date-fns-tz` içeride tam olarak buradaki `Intl` numarasını yapar.
 * `@internationalized/date` teknik olarak doğru ama bulaşıcı — `CalendarDate`
 * prop tiplerine, state'e ve `shared` sınırına kadar sızar.
 *
 * ⚠️ `lib/reports/period.ts` ile KARIŞTIRILMAMALI. O dosya bilerek
 * TARAYICI-YERELDİR (`getTimezoneOffset` kullanır) ve rapor dönemleri için
 * doğrudur. İki saat dilimi anlayışını tek dosyada birleştirmek, Faz 11'de
 * bulunan "1 numaralı hata"nın ta kendisiydi: sunucu bir uçta zonlu, başka
 * bir uçta UTC dönünce aynı an iki farklı güne düşüyordu.
 *
 * Çekirdek (`dayKeyOf`, `Date.UTC` tabanlı gün aritmetiği)
 * `apps/web-booking/src/components/booking/slot-grouping.ts`ten geliyor;
 * orada üretimde ve kendi testleriyle duruyor.
 */

/** `YYYY-MM-DD` — ŞUBE saat diliminde bir takvim günü. */
export type DayKey = string;

/** Geçersiz girdiler boş dize döner; çağıran `=== ''` ile ayıklar. */
const INVALID: DayKey = '';

// ---------------------------------------------------------------------------
// An → gün
// ---------------------------------------------------------------------------

/** Bir anın ŞUBE saat dilimindeki takvim günü. */
export function dayKeyOf(iso: string, timeZone: string): DayKey {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return INVALID;
  // `en-CA` zaten `YYYY-MM-DD` üretir; elle birleştirmeye gerek yok.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function todayKey(timeZone: string): DayKey {
  return dayKeyOf(new Date().toISOString(), timeZone);
}

// ---------------------------------------------------------------------------
// Gün aritmetiği — UTC üzerinden
// ---------------------------------------------------------------------------

/**
 * `new Date('2026-03-29')` yerel saate göre çözülseydi, yaz saati geçişinde
 * "+1 gün" 23 ya da 25 saat sürer ve ızgara bir günü atlar ya da tekrarlardı.
 * Takvim günü takvim aritmetiğiyle hesaplanmalı; bu yüzden `Date.UTC`.
 */
function parseKey(key: DayKey): number {
  const parts = key.split('-');
  if (parts.length !== 3) return Number.NaN;
  const [year, month, day] = parts.map((part) => Number.parseInt(part, 10));
  if (year === undefined || month === undefined || day === undefined) return Number.NaN;
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return Number.NaN;
  return Date.UTC(year, month - 1, day);
}

function keyOf(ms: number): DayKey {
  const date = new Date(ms);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

export function addDays(key: DayKey, days: number): DayKey {
  const base = parseKey(key);
  return Number.isNaN(base) ? INVALID : keyOf(base + days * 86_400_000);
}

export function daysBetween(from: DayKey, to: DayKey): number {
  const a = parseKey(from);
  const b = parseKey(to);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000);
}

/**
 * Haftanın başı — PAZARTESİ.
 *
 * `GET /calendar/week` `weekStart` bekliyor ve Türkiye'de hafta pazartesi
 * başlar. JS'in `getUTCDay()`i pazarı 0 sayar; pazartesiye hizalamak için
 * `(dow + 6) % 7` gün geri gidiliyor — pazar için 6, pazartesi için 0.
 */
export function weekStart(key: DayKey): DayKey {
  const base = parseKey(key);
  if (Number.isNaN(base)) return INVALID;
  const dow = new Date(base).getUTCDay();
  return keyOf(base - ((dow + 6) % 7) * 86_400_000);
}

/** `start`ten başlayan `count` günlük dizi. */
export function daysFrom(start: DayKey, count = 7): DayKey[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

// ---------------------------------------------------------------------------
// Izgara konumlandırma
// ---------------------------------------------------------------------------

/**
 * Bir anın ŞUBE saat dilimindeki gün içi dakikası (0–1439).
 *
 * Izgarada dikey konum bundan hesaplanır. `getHours()` KULLANILAMAZ: o
 * tarayıcının saat dilimini okur ve Berlin'den bakan yönetici randevuları
 * bir saat kaymış görürdü.
 */
export function minutesOfDay(iso: string, timeZone: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  // `en-GB` gece yarısını bazı ortamlarda '24' olarak biçimliyor.
  return (hour % 24) * 60 + minute;
}

/**
 * Verilen saat diliminin O ANDAKİ UTC ofseti, dakika cinsinden.
 *
 * Sabit `+03:00` gömmek yanlış olurdu: Türkiye bugün kalıcı `+03` olsa da
 * kod çok saat dilimli bir kiracıyı da taşımak zorunda ve DST'li bir dilimde
 * ofset yılın yarısında değişir. Ofset HEDEF AN için okunuyor.
 */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const get = (type: string): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * `(gün, dakika)` → offsetli ISO — API'ye gönderilebilir bir an.
 *
 * Örn. `localIsoAt('2026-09-07', 840, 'Europe/Istanbul')` →
 * `'2026-09-07T14:00:00+03:00'`.
 *
 * İki geçişli: önce yerel duvar saatini UTC sanıp bir tahmin kuruyoruz, o
 * tahminin ofsetiyle düzeltiyoruz, sonra DÜZELTİLMİŞ anın ofsetini yeniden
 * okuyup bir kez daha düzeltiyoruz. İkinci geçiş DST sınırı için: geçiş
 * gününde ilk tahminin ofseti yanlış tarafta kalabilir.
 *
 * ⚠️ DST geçişinde VAR OLMAYAN bir yerel saat (ör. saatlerin ileri alındığı
 * gecedeki 03:30) istenirse sonuç geçişten sonraki en yakın gerçek ana
 * düşer. Türkiye kalıcı `+03` olduğu için TR kiracılarda bu yol hiç
 * işlemiyor; test `Europe/Berlin` üzerinden geçiş gününü ayrıca sınıyor.
 */
export function localIsoAt(key: DayKey, minutes: number, timeZone: string): string {
  const base = parseKey(key);
  if (Number.isNaN(base)) return '';

  const wall = base + minutes * 60_000;
  let utcMs = wall - offsetMinutesAt(wall, timeZone) * 60_000;
  utcMs = wall - offsetMinutesAt(utcMs, timeZone) * 60_000;

  const offset = offsetMinutesAt(utcMs, timeZone);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const offsetText =
    `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}` +
    `:${String(abs % 60).padStart(2, '0')}`;

  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${key}T${hh}:${mm}:00${offsetText}`;
}

/**
 * Bir günün YARI AÇIK aralığı: `[from, to)`.
 *
 * Bitişi `23:59:59` yapmak, o saniyeye düşen bir randevuyu kaybetmek
 * demektir. Sunucu da yarı açık aralık kullanıyor; iki tarafın aynı
 * konvansiyonda olması şart.
 */
export function dayRange(key: DayKey, timeZone: string): { from: string; to: string } {
  return {
    from: localIsoAt(key, 0, timeZone),
    to: localIsoAt(addDays(key, 1), 0, timeZone),
  };
}

/** `count` günlük yarı açık aralık — hafta görünümü için. */
export function rangeFrom(
  start: DayKey,
  count: number,
  timeZone: string,
): { from: string; to: string } {
  return {
    from: localIsoAt(start, 0, timeZone),
    to: localIsoAt(addDays(start, count), 0, timeZone),
  };
}

// ---------------------------------------------------------------------------
// Biçimleme
// ---------------------------------------------------------------------------

export function formatTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** `'7 Eylül Pazartesi'` — gün anahtarı zaten yerelleştirilmiş bir tarih. */
export function formatDayLabel(key: DayKey): string {
  const base = parseKey(key);
  if (Number.isNaN(base)) return '';
  // Anahtar UTC'de kurulduğu için biçimleme de UTC'de yapılmalı; aksi hâlde
  // negatif ofsetli bir tarayıcıda bir gün geriye kayar.
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(new Date(base));
}

/**
 * Dar sütun başlığı: `{ weekday: 'Pzt', day: '7' }`.
 *
 * Hafta ızgarasında yedi sütun telefonda ~45px'e düşüyor; `formatDayLabel`in
 * `'7 Eylül Pazartesi'`si orada kırpılıp okunmaz hâle geliyordu.
 */
export function formatDayShort(key: DayKey): { weekday: string; day: string } {
  const base = parseKey(key);
  if (Number.isNaN(base)) return { weekday: '', day: '' };
  const date = new Date(base);
  return {
    weekday: new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', weekday: 'short' }).format(date),
    day: new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric' }).format(date),
  };
}

/** `'7 – 13 Eylül 2026'` — hafta başlığı. */
export function formatWeekLabel(start: DayKey): string {
  const from = parseKey(start);
  const to = parseKey(addDays(start, 6));
  if (Number.isNaN(from) || Number.isNaN(to)) return '';
  const day = new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric' });
  const full = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${day.format(new Date(from))} – ${full.format(new Date(to))}`;
}
