import type { AvailabilityDay, AvailabilitySlot } from '@klinara/shared';

/**
 * Uygunluk yanıtının EKRANA çevrilmesi — saf fonksiyonlar, bileşenden ayrı ki
 * test edilebilsin.
 *
 * iOS `BookingAvailabilityPresentation` ve Android `AvailabilityPresentation`
 * aynı kuralları ve aynı metinleri taşıyor; birinde değişen metin diğer ikisine
 * de işlenmeli.
 */

export type SlotPeriod = 'morning' | 'afternoon' | 'evening';

export const SLOT_PERIOD_LABEL: Record<SlotPeriod, string> = {
  morning: 'Sabah',
  afternoon: 'Öğleden sonra',
  evening: 'Akşam',
};

export interface SlotGroup<Slot extends AvailabilitySlot = AvailabilitySlot> {
  period: SlotPeriod;
  slots: Slot[];
}

/** Şube saat diliminde yerel saat (0–23). */
function localHour(iso: string, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false })
    .format(new Date(iso));
  // `en-GB` gece yarısını "24" değil "00" yazar; yine de korunuyoruz.
  return Number.parseInt(hour, 10) % 24;
}

function periodOf(hour: number): SlotPeriod {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Slotları sabah / öğleden sonra / akşam gruplarına böler. Sıra korunur, boş
 * grup dönmez. 30+ çipi tek düz akışta göstermek taranamıyordu; grup başlığı
 * gözün "öğleden sonra bir saat" aramasını tek bakışa indiriyor.
 */
export function groupSlots<Slot extends AvailabilitySlot>(
  slots: readonly Slot[],
  timeZone: string,
): SlotGroup<Slot>[] {
  const groups: SlotGroup<Slot>[] = [];
  for (const slot of slots) {
    const period = periodOf(localHour(slot.startsAt, timeZone));
    const last = groups.at(-1);
    if (last?.period === period) last.slots.push(slot);
    else groups.push({ period, slots: [slot] });
  }
  return groups;
}

export interface DayNotice {
  /** `info`: gün kuralı (kapalı/tatil…); `empty`: açık ama dolu. */
  tone: 'info' | 'empty';
  title: string;
  detail: string;
}

/**
 * Slot listesi boşken NEDEN boş olduğu. `day` yoksa (eski API ya da
 * tanımsız gün) açık kabul ediliyor — en az şaşırtan varsayım "dolu".
 */
export function emptyDayNotice(day: AvailabilityDay | undefined): DayNotice {
  switch (day?.status) {
    case 'holiday':
      return {
        tone: 'info',
        title: day.holidayName === null ? 'Klinik bu gün tatil' : `Tatil · ${day.holidayName}`,
        detail: 'Bu gün randevu alınmıyor. Başka bir gün seçin.',
      };
    case 'closed':
      return {
        tone: 'info',
        title: 'Şube bu gün kapalı',
        detail: 'Haftalık çalışma saatlerinde bu gün kapalı. Başka bir gün seçin.',
      };
    case 'past':
      return {
        tone: 'info',
        title: 'Bu günün çalışma saatleri geçti',
        detail: 'İleri bir tarih seçin.',
      };
    case 'beyond_window':
      return {
        tone: 'info',
        title: 'Rezervasyon penceresinin dışında',
        detail: 'Bu tarih için henüz randevu açılmadı. Daha yakın bir gün seçin.',
      };
    default:
      return {
        tone: 'empty',
        title: 'Bu gün boş saat kalmadı',
        detail: 'Tüm saatler dolu. Başka bir gün ya da personel deneyin.',
      };
  }
}

/** Açık günün ek notu: yarım gün tatilde daraltılmış saatler. */
export function openDayNote(day: AvailabilityDay | undefined): string | null {
  if (day?.status !== 'open' || day.holidayName === null) return null;
  const hours = day.opensAt !== null && day.closesAt !== null ? ` ${day.opensAt}–${day.closesAt}` : '';
  return `${day.holidayName} · kısaltılmış çalışma saatleri${hours}`;
}

/** Tarih seçicide kapatılacak günlerin kısa etiketi; açık gün `null`. */
export function unavailableDayLabel(day: AvailabilityDay): string | null {
  switch (day.status) {
    case 'holiday':
      return day.holidayName ?? 'Tatil';
    case 'closed':
      return 'Kapalı';
    case 'past':
      return 'Geçti';
    case 'beyond_window':
      return 'Rezervasyona kapalı';
    default:
      return null;
  }
}
