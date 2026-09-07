import { describe, expect, it } from 'vitest';
import { formatMoney, inputToMinor, minorToInput } from '../../src/lib/format/money';

describe('para dönüşümü', () => {
  it('kuruş → metin', () => {
    expect(minorToInput(50000)).toBe('500,00');
    expect(minorToInput(1)).toBe('0,01');
    expect(minorToInput(0)).toBe('0,00');
    expect(minorToInput(105)).toBe('1,05');
    expect(minorToInput(-2550)).toBe('-25,50');
  });

  it('metin → kuruş, TAMSAYI aritmetiğiyle', () => {
    // `parseFloat('12.10') * 100` JavaScript'te 1209.9999999999998 eder.
    // Bir kuruşluk kayma fiyat listesinde görünmez, tahsilat
    // mutabakatında görünür.
    expect(inputToMinor('12,10')).toBe(1210);
    expect(inputToMinor('12.10')).toBe(1210);
    expect(inputToMinor('0,07')).toBe(7);
    expect(inputToMinor('500')).toBe(50000);
    expect(inputToMinor('1000,99')).toBe(100099);
  });

  it('tek haneli ondalık ON KURUŞ demek, bir kuruş değil', () => {
    // `'5,5'` beş lira elli kuruş; beş lira beş kuruş DEĞİL.
    expect(inputToMinor('5,5')).toBe(550);
    expect(inputToMinor('5,05')).toBe(505);
  });

  it('hem virgül hem nokta kabul ediliyor', () => {
    // Kullanıcı Türkçe klavyede virgül, sayısal tuş takımında nokta yazar;
    // birini reddetmek "girdiğim fiyat kaydolmuyor" demektir.
    expect(inputToMinor('99,90')).toBe(inputToMinor('99.90'));
  });

  it('BİNLİK ayıracı reddediliyor — belirsizlik pahalı', () => {
    // `1.234` "bin iki yüz otuz dört" mü "bir tam iki üç dört" mü? Yanlış
    // tahmin fiyatı bin katına çıkarır.
    expect(inputToMinor('1.234,56')).toBeNull();
    expect(inputToMinor('1,234.56')).toBeNull();
  });

  it('geçersiz girdi null döner', () => {
    expect(inputToMinor('')).toBeNull();
    expect(inputToMinor('abc')).toBeNull();
    expect(inputToMinor('12,345')).toBeNull(); // üç ondalık
    expect(inputToMinor('--5')).toBeNull();
  });

  it('YARIM yazılmış ondalık kabul ediliyor — yazarken hata basılmaz', () => {
    // Kullanıcı `'12,50'` yazarken `'12,'` aşamasından GEÇİYOR. Orada `null`
    // dönmek her tuşta yanıp sönen bir hata demek; `'12,'` = 12 lira 0 kuruş
    // olarak okumak hem doğru hem sessiz.
    expect(inputToMinor('12,')).toBe(1200);
    expect(inputToMinor('12.')).toBe(1200);
  });

  it('gidiş-dönüş kayıpsız', () => {
    for (const minor of [0, 1, 99, 100, 12345, 999999]) {
      expect(inputToMinor(minorToInput(minor))).toBe(minor);
    }
  });

  it('gösterim para birimiyle', () => {
    const formatted = formatMoney(50000);
    expect(formatted).toContain('500');
    expect(formatted).toMatch(/₺|TRY/);
  });
});
