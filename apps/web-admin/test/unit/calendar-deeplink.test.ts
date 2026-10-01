import { describe, expect, it } from 'vitest';
import { appointmentHref, parseDayParam } from '../../src/lib/calendar/deeplink';

describe('takvim derin bağlantısı', () => {
  it('günü ŞUBE saat diliminde hesaplıyor, tarayıcınınkinde değil', () => {
    // 22:30 UTC = İstanbul'da ertesi gün 01:30.
    const href = appointmentHref({ id: 'a1', startsAt: '2026-09-29T22:30:00Z' }, 'Europe/Istanbul');
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/takvim');
    expect(url.searchParams.get('gun')).toBe('2026-09-30');
    expect(url.searchParams.get('randevu')).toBe('a1');
  });

  it('kimliği URL için kaçışlıyor', () => {
    const href = appointmentHref({ id: 'a&b=1', startsAt: '2026-09-29T10:00:00Z' }, 'UTC');
    expect(new URL(href, 'http://x').searchParams.get('randevu')).toBe('a&b=1');
  });

  it('yalnız gerçek gün anahtarlarını kabul ediyor', () => {
    expect(parseDayParam('2026-09-30')).toBe('2026-09-30');
    expect(parseDayParam(null)).toBeNull();
    expect(parseDayParam('')).toBeNull();
    expect(parseDayParam('30.09.2026')).toBeNull();
    expect(parseDayParam('2026-02-31')).toBeNull();
    expect(parseDayParam('2026-13-01')).toBeNull();
  });
});
