import { describe, it, expect } from 'vitest';
import { toZonedIso } from '../../src/common/time';

describe('toZonedIso', () => {
  it('İstanbul için sabit +03:00 üretir', () => {
    expect(toZonedIso(new Date('2026-09-07T06:00:00Z'), 'Europe/Istanbul')).toBe(
      '2026-09-07T09:00:00+03:00',
    );
    // Türkiye 2016'dan beri kalıcı UTC+3; kışın da offset değişmez.
    expect(toZonedIso(new Date('2026-01-15T06:00:00Z'), 'Europe/Istanbul')).toBe(
      '2026-01-15T09:00:00+03:00',
    );
  });

  it('yaz saati uygulayan bölgede offset’i ANLIK hesaplar', () => {
    // 25 Ekim 2026: Berlin'de saatler geri alınır (CEST +02:00 → CET +01:00).
    expect(toZonedIso(new Date('2026-10-23T07:00:00Z'), 'Europe/Berlin')).toBe(
      '2026-10-23T09:00:00+02:00',
    );
    expect(toZonedIso(new Date('2026-10-25T08:00:00Z'), 'Europe/Berlin')).toBe(
      '2026-10-25T09:00:00+01:00',
    );
  });

  it('UTC için Z döner', () => {
    expect(toZonedIso(new Date('2026-09-07T06:00:00Z'), 'UTC')).toBe('2026-09-07T06:00:00Z');
  });

  it('gece yarısını bir sonraki güne KAYDIRMAZ', () => {
    // `hour12: false` bazı ICU sürümlerinde 24:00 üretir ve tarih kayar.
    expect(toZonedIso(new Date('2026-09-06T21:00:00Z'), 'Europe/Istanbul')).toBe(
      '2026-09-07T00:00:00+03:00',
    );
  });

  it('yarım saatlik offset’leri doğru biçimler', () => {
    expect(toZonedIso(new Date('2026-09-07T06:00:00Z'), 'Asia/Kolkata')).toBe(
      '2026-09-07T11:30:00+05:30',
    );
  });
});
