import { describe, it, expect } from 'vitest';
import {
  addDays,
  dayKeyOf,
  dayRange,
  daysBetween,
  daysFrom,
  formatDayLabel,
  formatTime,
  formatWeekLabel,
  localIsoAt,
  minutesOfDay,
  rangeFrom,
  weekStart,
} from '../../src/lib/calendar/date';

const IST = 'Europe/Istanbul';
/** DST'li bir dilim: Türkiye kalıcı +03 olduğu için geçiş yolu ancak burada sınanır. */
const BERLIN = 'Europe/Berlin';

describe('takvim tarih katmanı', () => {
  describe('an → gün', () => {
    it('anı ŞUBENİN gününe çevirir, tarayıcının değil', () => {
      // 21:30 UTC = ertesi gün 00:30 İstanbul'da. Tarayıcı saat dilimi ne
      // olursa olsun sonuç aynı olmalı.
      expect(dayKeyOf('2026-09-07T21:30:00Z', IST)).toBe('2026-09-08');
      expect(dayKeyOf('2026-09-07T21:30:00Z', 'UTC')).toBe('2026-09-07');
    });

    it('offsetli ve UTC gösterimi AYNI günü verir', () => {
      // Faz 11'in "1 numaralı hatası" tam olarak buydu: sunucu bir uçta
      // zonlu, başka bir uçta UTC dönüyordu ve aynı an iki güne düşüyordu.
      expect(dayKeyOf('2026-09-07T14:00:00+03:00', IST)).toBe(
        dayKeyOf('2026-09-07T11:00:00Z', IST),
      );
    });

    it('geçersiz girdide boş dize döner, patlamaz', () => {
      expect(dayKeyOf('bu bir tarih değil', IST)).toBe('');
      expect(dayKeyOf('', IST)).toBe('');
    });
  });

  describe('gün aritmetiği', () => {
    it('ay ve yıl sınırını geçer', () => {
      expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('artık yılı bilir', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('YAZ SAATİ geçişinde bir günü atlamaz', () => {
      // 29 Mart 2026 Berlin'de saatlerin ileri alındığı gün: o gün 23 saat.
      // Yerel saat aritmetiği kullanılsaydı "+1 gün" 30 Mart'a değil hâlâ
      // 29 Mart'a düşerdi.
      expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
      expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
      // Geri alınan gün (25 saat) da aynı şekilde.
      expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    });

    it('daysBetween iki yönlü ve tutarlı', () => {
      expect(daysBetween('2026-09-07', '2026-09-14')).toBe(7);
      expect(daysBetween('2026-09-14', '2026-09-07')).toBe(-7);
      expect(daysBetween('2026-09-07', '2026-09-07')).toBe(0);
      // DST geçişini kapsayan aralık da tam gün sayısı vermeli.
      expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    });

    it('geçersiz anahtarda boş dize döner', () => {
      expect(addDays('', 1)).toBe('');
      expect(addDays('2026-09', 1)).toBe('');
      expect(daysBetween('', '2026-09-07')).toBe(0);
    });
  });

  describe('hafta', () => {
    it('hafta PAZARTESİ başlar', () => {
      // 2026-09-07 bir Pazartesi.
      expect(weekStart('2026-09-07')).toBe('2026-09-07');
      expect(weekStart('2026-09-10')).toBe('2026-09-07'); // Perşembe
      expect(weekStart('2026-09-13')).toBe('2026-09-07'); // Pazar
      expect(weekStart('2026-09-14')).toBe('2026-09-14'); // sonraki Pazartesi
    });

    it('PAZAR bir önceki haftaya aittir', () => {
      // En kolay yapılan hata: `getUTCDay()` pazarı 0 sayar ve naif bir
      // çıkarma pazarı KENDİ haftasının başı yapar.
      expect(weekStart('2026-09-06')).toBe('2026-08-31');
    });

    it('daysFrom ardışık gün üretir', () => {
      expect(daysFrom('2026-09-07', 3)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
      expect(daysFrom('2026-09-07')).toHaveLength(7);
    });
  });

  describe('gün içi dakika', () => {
    it('ŞUBENİN saat dilimindeki dakikayı verir', () => {
      expect(minutesOfDay('2026-09-07T14:00:00+03:00', IST)).toBe(14 * 60);
      // Aynı an UTC'de 11:00.
      expect(minutesOfDay('2026-09-07T14:00:00+03:00', 'UTC')).toBe(11 * 60);
    });

    it('gece yarısı 0 döner, 1440 değil', () => {
      expect(minutesOfDay('2026-09-07T00:00:00+03:00', IST)).toBe(0);
    });

    it('gün sonunu doğru verir', () => {
      expect(minutesOfDay('2026-09-07T23:30:00+03:00', IST)).toBe(23 * 60 + 30);
    });
  });

  describe('localIsoAt', () => {
    it('şube saatinde offsetli bir an üretir', () => {
      expect(localIsoAt('2026-09-07', 14 * 60, IST)).toBe('2026-09-07T14:00:00+03:00');
      expect(localIsoAt('2026-09-07', 0, IST)).toBe('2026-09-07T00:00:00+03:00');
      expect(localIsoAt('2026-09-07', 9 * 60 + 30, IST)).toBe('2026-09-07T09:30:00+03:00');
    });

    it('ürettiği an, aynı güne geri çözülür', () => {
      // Asıl invariant bu: ızgarada tıklanan saat, sunucuya gidip geri
      // geldiğinde aynı hücreye düşmeli.
      for (const minutes of [0, 1, 540, 720, 1439]) {
        const iso = localIsoAt('2026-09-07', minutes, IST);
        expect(dayKeyOf(iso, IST)).toBe('2026-09-07');
        expect(minutesOfDay(iso, IST)).toBe(minutes);
      }
    });

    it('DST\'li dilimde ofseti HEDEF ANA göre okur, sabit gömmez', () => {
      // Berlin kışın +01, yazın +02. Sabit bir ofset gömülseydi biri yanlış
      // olurdu.
      expect(localIsoAt('2026-01-15', 12 * 60, BERLIN)).toBe('2026-01-15T12:00:00+01:00');
      expect(localIsoAt('2026-07-15', 12 * 60, BERLIN)).toBe('2026-07-15T12:00:00+02:00');
    });

    it('DST geçiş gününde de aynı güne çözülür', () => {
      // 2026-03-29 Berlin'de saatler 02:00 → 03:00. Geçişten sonraki bir
      // saat doğru ofseti (+02) almalı.
      const afterJump = localIsoAt('2026-03-29', 12 * 60, BERLIN);
      expect(afterJump).toBe('2026-03-29T12:00:00+02:00');
      expect(dayKeyOf(afterJump, BERLIN)).toBe('2026-03-29');

      // Geçişten önceki saat hâlâ +01.
      const beforeJump = localIsoAt('2026-03-29', 60, BERLIN);
      expect(beforeJump).toBe('2026-03-29T01:00:00+01:00');
      expect(dayKeyOf(beforeJump, BERLIN)).toBe('2026-03-29');
    });

    it('geçersiz anahtarda boş dize döner', () => {
      expect(localIsoAt('', 0, IST)).toBe('');
    });
  });

  describe('aralıklar YARI AÇIK', () => {
    it('gün aralığı ertesi günün başında biter', () => {
      // `23:59:59` yazmak o saniyeye düşen randevuyu kaybetmek olurdu.
      expect(dayRange('2026-09-07', IST)).toEqual({
        from: '2026-09-07T00:00:00+03:00',
        to: '2026-09-08T00:00:00+03:00',
      });
    });

    it('hafta aralığı yedi gün sonra biter', () => {
      expect(rangeFrom('2026-09-07', 7, IST)).toEqual({
        from: '2026-09-07T00:00:00+03:00',
        to: '2026-09-14T00:00:00+03:00',
      });
    });
  });

  describe('biçimleme', () => {
    it('saati şube diliminde iki haneli verir', () => {
      expect(formatTime('2026-09-07T09:05:00+03:00', IST)).toBe('09:05');
      expect(formatTime('2026-09-07T14:00:00+03:00', 'UTC')).toBe('11:00');
      expect(formatTime('gecersiz', IST)).toBe('');
    });

    it('gün etiketi tarayıcı saat diliminden ETKİLENMEZ', () => {
      // Anahtar UTC'de kurulduğu için biçimleme de UTC'de yapılıyor; aksi
      // hâlde negatif ofsetli bir tarayıcıda bir gün geriye kayardı.
      expect(formatDayLabel('2026-09-07')).toContain('7');
      expect(formatDayLabel('2026-09-07')).toContain('Eylül');
      expect(formatDayLabel('2026-09-07')).toContain('Pazartesi');
      expect(formatDayLabel('')).toBe('');
    });

    it('hafta etiketi ilk ve son günü kapsar', () => {
      const label = formatWeekLabel('2026-09-07');
      expect(label).toContain('7');
      expect(label).toContain('13');
      expect(label).toContain('Eylül');
      expect(label).toContain('2026');
    });
  });
});
