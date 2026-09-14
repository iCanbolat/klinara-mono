import type { CalendarEntry, DensityBucket } from '@klinara/shared';
import { dayKeyOf, minutesOfDay, type DayKey } from './date';
import { layoutLanes } from './layout';

/**
 * Izgara ve ajanda görünümlerinin ortak hesabı — saf, React'siz.
 *
 * Gün ızgarası, hafta ızgarasının her sütunu ve ajanda listesi AYNI soruları
 * soruyor: "bu randevu hangi güne düşer, günün kaçıncı dakikasında başlar,
 * yanındakilerle nasıl paylaşır". Bu hesap bileşenlerin `useMemo`larında
 * kalsaydı üç kopya olurdu ve saat dilimi hatası (Berlin'den bakan yönetici)
 * üçünden birinde sessizce yaşardı.
 */

export interface PositionedEntry {
  entry: CalendarEntry;
  startMin: number;
  endMin: number;
  lane: number;
  laneCount: number;
}

export const DEFAULT_WINDOW: readonly [number, number] = [8 * 60, 20 * 60];

/** Girdileri gün içi dakikaya çevirip çakışanları şeritlere yerleştirir. */
export function positionEntries(
  entries: readonly CalendarEntry[],
  timezone: string,
): PositionedEntry[] {
  const spans = entries.map((entry) => {
    const startMin = minutesOfDay(entry.startsAt, timezone);
    let endMin = minutesOfDay(entry.endsAt, timezone);
    // Gece yarısını aşan randevu: bitiş dakikası başlangıçtan küçük çıkar.
    // Izgara tek gün çizdiği için bitiş gün sonuna sabitleniyor.
    if (endMin <= startMin) endMin = 24 * 60;
    return { entry, startMin, endMin };
  });

  const lanes = layoutLanes(
    spans.map((span) => ({ id: span.entry.id, startMin: span.startMin, endMin: span.endMin })),
  );
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));

  return spans.map((span) => {
    const lane = laneById.get(span.entry.id);
    return { ...span, lane: lane?.lane ?? 0, laneCount: lane?.laneCount ?? 1 };
  });
}

/**
 * Gösterilecek saat aralığı — VERİDEN türetiliyor, sabit değil: 07:00'de açılan
 * bir kliniğin randevusu sabit pencerenin dışına düşerdi. Taban 08–20;
 * randevular taşıyorsa pencere genişliyor. Saat başına yuvarlanıyor ki saat
 * çizgileri tam saatte otursun.
 */
export function gridWindow(
  rows: readonly Pick<PositionedEntry, 'startMin' | 'endMin'>[],
  defaults: readonly [number, number] = DEFAULT_WINDOW,
): { start: number; end: number } {
  const earliest = rows.reduce((min, row) => Math.min(min, row.startMin), defaults[0]);
  const latest = rows.reduce((max, row) => Math.max(max, row.endMin), defaults[1]);
  return { start: Math.floor(earliest / 60) * 60, end: Math.ceil(latest / 60) * 60 };
}

/** Pencerenin tam saatleri (dakika cinsinden), iki uç dahil. */
export function windowHours(window: { start: number; end: number }): number[] {
  return Array.from(
    { length: Math.floor((window.end - window.start) / 60) + 1 },
    (_, index) => window.start + index * 60,
  );
}

/**
 * Girdileri ŞUBE saat dilimindeki güne göre gruplar; her gün başlangıca göre
 * sıralı. `days` dışındaki bir güne düşen girdi (yanıt aralığının kenarı)
 * ATILIYOR: listede görünmeyen bir gün başlığı altında çizilmesinin anlamı yok.
 */
export function groupByDay(
  entries: readonly CalendarEntry[],
  timezone: string,
  days: readonly DayKey[],
): Map<DayKey, CalendarEntry[]> {
  const groups = new Map<DayKey, CalendarEntry[]>(days.map((day) => [day, []]));
  for (const entry of entries) {
    groups.get(dayKeyOf(entry.startsAt, timezone))?.push(entry);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
    });
  }
  return groups;
}

/** `gün|saat → randevu sayısı` ve en yoğun hücre (renk ölçeği ona göre). */
export function densityMap(density: readonly DensityBucket[]): {
  counts: Map<string, number>;
  peak: number;
} {
  const counts = new Map<string, number>();
  let peak = 0;
  for (const bucket of density) {
    const key = densityKey(bucket.localDay, bucket.localHour);
    const next = (counts.get(key) ?? 0) + bucket.appointmentCount;
    counts.set(key, next);
    if (next > peak) peak = next;
  }
  return { counts, peak };
}

export function densityKey(day: DayKey, hour: number): string {
  return `${day}|${String(hour)}`;
}
