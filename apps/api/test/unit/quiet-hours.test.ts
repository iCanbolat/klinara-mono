import { describe, it, expect } from 'vitest';
import {
  isQuietHour,
  nextSendableInstant,
} from '../../src/modules/notifications/quiet-hours';

const ISTANBUL = 'Europe/Istanbul';
/** Türkiye yaz saati UYGULAMAZ (+03 sabit); geçiş davranışı Berlin ile sınanır. */
const BERLIN = 'Europe/Berlin';

const window = { start: '21:00', end: '09:00' };

describe('sessiz saatler (Batch 8.1)', () => {
  it('gece yarısını AŞAN pencerenin her iki yakasını da kapsar', () => {
    // 23:30 İstanbul
    expect(isQuietHour(new Date('2026-09-07T20:30:00Z'), ISTANBUL, window)).toBe(true);
    // 02:00 İstanbul
    expect(isQuietHour(new Date('2026-09-07T23:00:00Z'), ISTANBUL, window)).toBe(true);
    // 10:00 İstanbul
    expect(isQuietHour(new Date('2026-09-07T07:00:00Z'), ISTANBUL, window)).toBe(false);
    // 20:59 İstanbul — pencere başlamadan hemen önce
    expect(isQuietHour(new Date('2026-09-07T17:59:00Z'), ISTANBUL, window)).toBe(false);
  });

  it('akşam üretilen mesajı ERTESİ sabahın bitiş saatine öteler', () => {
    // 7 Eylül 23:30 İstanbul → 8 Eylül 09:00 İstanbul (06:00 UTC)
    const shifted = nextSendableInstant(new Date('2026-09-07T20:30:00Z'), ISTANBUL, window);
    expect(shifted.toISOString()).toBe('2026-09-08T06:00:00.000Z');
  });

  it('gece yarısından sonra üretilen mesajı AYNI sabaha öteler', () => {
    // 8 Eylül 02:00 İstanbul → aynı gün 09:00
    const shifted = nextSendableInstant(new Date('2026-09-07T23:00:00Z'), ISTANBUL, window);
    expect(shifted.toISOString()).toBe('2026-09-08T06:00:00.000Z');
  });

  it('pencere dışındaki anı DEĞİŞTİRMEZ', () => {
    const instant = new Date('2026-09-07T07:00:00Z');
    expect(nextSendableInstant(instant, ISTANBUL, window).toISOString()).toBe(
      instant.toISOString(),
    );
  });

  it('yaz saati geçiş gecesinde bitiş saati YEREL 09:00 olarak korunur', () => {
    // Berlin 29 Mart 2026'da 02:00 → 03:00 atlar (+01:00 → +02:00).
    // 28 Mart 23:00 yerel (22:00Z) sessiz saatte; hedef 29 Mart 09:00 yerel,
    // yani 07:00Z — saf "gün başlangıcı + 540 dakika" hesabı 08:00Z verirdi.
    const shifted = nextSendableInstant(new Date('2026-03-28T22:00:00Z'), BERLIN, window);
    expect(shifted.toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });

  it('başlangıç ve bitiş aynıysa pencere YOKTUR', () => {
    expect(isQuietHour(new Date('2026-09-07T20:30:00Z'), ISTANBUL, { start: '09:00', end: '09:00' })).toBe(
      false,
    );
  });
});
