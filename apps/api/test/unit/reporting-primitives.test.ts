import { describe, expect, it } from 'vitest';
import { CSV_DELIMITER, UTF8_BOM, csvField, csvFilename, csvMoney, toCsv } from '../../src/modules/reporting/csv';
import {
  approximateDays,
  percentDelta,
  previousPeriod,
  toPeriod,
} from '../../src/modules/reporting/report-period';

/**
 * Rapor primitifleri veritabanına dokunmuyor; testcontainers'a bağlamak hem
 * yavaş hem de yanıltıcı olurdu — buradaki hatalar SQL hataları değil,
 * aritmetik ve biçim hataları.
 */
describe('dönem matematiği', () => {
  it('önceki dönem AYNI UZUNLUKTA ve bitişik', () => {
    const period = toPeriod('2026-09-01T00:00:00+03:00', '2026-10-01T00:00:00+03:00');
    const previous = previousPeriod(period);

    // Bitişik: öncekinin sonu, şimdikinin başlangıcı.
    expect(previous.to.toISOString()).toBe(period.from.toISOString());
    // Aynı uzunluk — takvim ayı DEĞİL. Eylül 30 gün, ağustos 31; "önceki ay"
    // deseydik 31 günlük bir pencereyle kıyaslar ve doluluğu yapay olarak
    // düşürürdük.
    expect(previous.to.getTime() - previous.from.getTime()).toBe(
      period.to.getTime() - period.from.getTime(),
    );
    expect(previous.from.toISOString()).toBe('2026-08-01T21:00:00.000Z');
  });

  it('yaz saati geçişi pencereyi kaydırmıyor — aralık MUTLAK', () => {
    // 25 Ekim 2026 TR'de saat geri alınmıyor (2016'dan beri kalıcı +03), ama
    // aralık zaten mutlak anlardan oluştuğu için yerel kural değişse de
    // uzunluk korunur. Test bunu sabitliyor.
    const period = toPeriod('2026-10-24T00:00:00+03:00', '2026-10-26T00:00:00+03:00');
    expect(approximateDays(period)).toBe(2);
    expect(approximateDays(previousPeriod(period))).toBe(2);
  });

  it('yüzde değişim: sıfır payda KIYASLANAMAZ, sıfır değil', () => {
    expect(percentDelta(150, 100)).toBe(50);
    expect(percentDelta(50, 100)).toBe(-50);
    // Önceki dönem sıfırken `0` yazmak "değişim yok" yalanı olurdu.
    expect(percentDelta(42, 0)).toBeNull();
    // İkisi de sıfırsa gerçekten değişim yok.
    expect(percentDelta(0, 0)).toBe(0);
    // İki basamağa yuvarlanıyor; aksi hâlde JSON'a 33.33333333333333 girerdi.
    expect(percentDelta(4, 3)).toBe(33.33);
  });
});

describe('CSV', () => {
  it('BOM ile başlıyor ve `;` ile ayırıyor', () => {
    const csv = toCsv(['Ad', 'Tutar'], [['Lazer', '1.200,00']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain(`Ad${CSV_DELIMITER}Tutar`);
    // Satır sonu CRLF — `\n` bazı Excel sürümlerinde tek satır gibi okunuyor.
    expect(csv).toContain('\r\n');
  });

  it('ayraç, tırnak ve satır sonu içeren alanları kaçırıyor', () => {
    expect(csvField('düz')).toBe('düz');
    // Ayraç alanın içindeyse tırnaklanmalı, yoksa sütun kayardı.
    expect(csvField('Lazer; Epilasyon')).toBe('"Lazer; Epilasyon"');
    // İçerideki tırnak ikileniyor.
    expect(csvField('12" ekran')).toBe('"12"" ekran"');
    expect(csvField('iki\nsatır')).toBe('"iki\nsatır"');
    // Yalnız `\r` de tetikliyor: tırnaklanmazsa satırı bölerdi.
    expect(csvField('a\rb')).toBe('"a\rb"');
    expect(csvField(null)).toBe('');
    expect(csvField(0)).toBe('0');
  });

  it('para FLOATA UĞRAMADAN ondalığa çevriliyor', () => {
    expect(csvMoney(123456)).toBe('1234,56');
    // Kritik durum: kuruş basamağı sıfırlarla dolmalı.
    expect(csvMoney(5)).toBe('0,05');
    expect(csvMoney(0)).toBe('0,00');
    expect(csvMoney(100)).toBe('1,00');
    // İade satırı negatiftir.
    expect(csvMoney(-4250)).toBe('-42,50');
    // Float yolu olsaydı bu değer 81.32999999999999 üzerinden bozulurdu.
    expect(csvMoney(8133)).toBe('81,33');
  });

  it('dosya adı ASCII ve gün taneciğinde', () => {
    expect(csvFilename('revenue', '2026-09-01T00:00:00+03:00', '2026-10-01T00:00:00+03:00')).toBe(
      'revenue-2026-09-01-2026-10-01.csv',
    );
    // Yol ayracı ya da Türkçe karakter başlığa sızmıyor.
    expect(csvFilename('../ciro şubat', '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z')).toBe(
      'ciro-ubat-2026-09-01-2026-09-02.csv',
    );
  });
});
