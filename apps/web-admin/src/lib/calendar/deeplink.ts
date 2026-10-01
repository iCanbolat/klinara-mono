import { addDays, dayKeyOf, type DayKey } from './date';

/**
 * Takvime derin bağlantı: `/takvim?gun=2026-09-30&randevu=<id>`.
 *
 * `gun` randevunun ŞUBE saat dilimindeki günü — tarayıcının günü değil.
 * Gece yarısına yakın bir randevu için ikisi farklı olabilir ve takvim,
 * randevunun yazıldığı günü açmalı.
 */
export const CALENDAR_DAY_PARAM = 'gun';
export const CALENDAR_APPOINTMENT_PARAM = 'randevu';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Sorgudan gelen değer gerçekten bir gün anahtarı mı; değilse `null`. */
export function parseDayParam(value: string | null): DayKey | null {
  if (value === null || !DAY_KEY.test(value)) return null;
  // `2026-02-31` gibi biçimi tutan ama takvimde olmayan günler: gidip
  // dönünce aynı anahtar çıkmıyor.
  return addDays(value, 0) === value ? value : null;
}

export function appointmentHref(
  appointment: { id: string; startsAt: string },
  timezone: string,
): string {
  const params = new URLSearchParams({
    [CALENDAR_DAY_PARAM]: dayKeyOf(appointment.startsAt, timezone),
    [CALENDAR_APPOINTMENT_PARAM]: appointment.id,
  });
  return `/takvim?${params.toString()}`;
}
