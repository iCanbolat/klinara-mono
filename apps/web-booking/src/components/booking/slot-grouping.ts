import type { PublicSlot } from '@klinara/shared';

/**
 * Slot listesinin GÜN ve GÜN BÖLÜMÜ eksenine ayrılması.
 *
 * Saf tutuluyor (React yok, ağ yok) çünkü buradaki tek gerçek risk SAAT
 * DİLİMİ: sunucu bir uçta zonlu (`+03:00`), başka bir uçta UTC (`Z`) dönerse
 * aynı slot iki farklı güne düşer — Faz 11'de bulunan 1 numaralı hata tam
 * olarak buydu. Bütün dönüşümler ŞUBENİN saat diliminde yapılıyor ve bu dosya
 * ayrı ayrı test ediliyor.
 */

export type DayKey = string; // `YYYY-MM-DD`
export type PartOfDay = 'morning' | 'afternoon' | 'evening';

export const PART_ORDER: readonly PartOfDay[] = ['morning', 'afternoon', 'evening'];

/** Bir anın ŞUBE saat dilimindeki takvim günü. */
export function dayKeyOf(iso: string, timeZone: string): DayKey {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
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

/**
 * Gün aritmetiği UTC üzerinden.
 *
 * `new Date('2026-03-29')` yerel saate göre çözülseydi, yaz saati geçişinde
 * "+1 gün" 23 ya da 25 saat sürer ve şerit bir günü atlardı. Takvim günü
 * takvim aritmetiğiyle hesaplanmalı.
 */
function parseKey(key: DayKey): number {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  if (year === undefined || month === undefined || day === undefined) return Number.NaN;
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
  return Number.isNaN(base) ? key : keyOf(base + days * 86_400_000);
}

export function daysBetween(from: DayKey, to: DayKey): number {
  const a = parseKey(from);
  const b = parseKey(to);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000);
}

/** Şeritteki gün dizisi. Pencere PAZARTESİYE değil BUGÜNE hizalı: cumartesi
 *  günü sayfayı açan biri iki gün değil yedi gün görmeli. */
export function daysFrom(start: DayKey, count = 7): DayKey[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function groupSlotsByDay(
  slots: PublicSlot[],
  timeZone: string,
): Map<DayKey, PublicSlot[]> {
  const byDay = new Map<DayKey, PublicSlot[]>();
  for (const slot of slots) {
    const key = dayKeyOf(slot.startsAt, timeZone);
    if (key === '') continue;
    const bucket = byDay.get(key);
    if (bucket === undefined) byDay.set(key, [slot]);
    else bucket.push(slot);
  }
  return byDay;
}

/** Şubenin duvar saatine göre saat (0–23). */
export function hourOf(iso: string, timeZone: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '0';
  return Number.parseInt(hour, 10);
}

export function partOfDay(iso: string, timeZone: string): PartOfDay {
  const hour = hourOf(iso, timeZone);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function groupByPart(
  slots: PublicSlot[],
  timeZone: string,
): { part: PartOfDay; slots: PublicSlot[] }[] {
  return PART_ORDER.map((part) => ({
    part,
    slots: slots.filter((slot) => partOfDay(slot.startsAt, timeZone) === part),
  })).filter((group) => group.slots.length > 0);
}

/** `from` DAHİL, slot'u olan ilk gün. Yoksa `null`. */
export function nextAvailableDay(
  byDay: Map<DayKey, PublicSlot[]>,
  from: DayKey,
): DayKey | null {
  const days = [...byDay.keys()]
    .filter((key) => (byDay.get(key)?.length ?? 0) > 0 && key >= from)
    .sort();
  return days[0] ?? null;
}

/* --- Gösterim yardımcıları: hepsi ŞUBE saat diliminde. --- */

export function formatTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Şerit çipi: `Pzt` gibi kısa gün adı. */
export function formatWeekdayShort(key: DayKey): string {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(parseKey(key)),
  );
}

export function formatDayNumber(key: DayKey): string {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', day: 'numeric' }).format(
    new Date(parseKey(key)),
  );
}

/** `12 Eylül Cumartesi` */
export function formatDayLong(key: DayKey): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(new Date(parseKey(key)));
}

/** `12 Eylül` */
export function formatDayShort(key: DayKey): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).format(new Date(parseKey(key)));
}

export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Kuruş → yerelleştirilmiş para birimi. */
export function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}
