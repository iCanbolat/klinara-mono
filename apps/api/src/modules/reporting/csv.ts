/**
 * CSV üretimi — saf, kütüphanesiz.
 *
 * Bir CSV kütüphanesi eklenmedi: burada gereken tek karmaşık kural alan
 * kaçışıdır ve o da altı satır. Bağımlılık, kaçış kuralını okunabilir tutmaz,
 * yalnız başka bir dosyaya taşır.
 *
 * BU DOSYA EXCEL İÇİN YAZILDI, RFC 4180 İÇİN DEĞİL. Raporu indiren kişinin
 * ilk işi onu Excel'de açmaktır ve Türkçe yerelde Excel iki şey bekler:
 * `;` ayracı ve ondalıkta virgül. Standarda uyup kullanıcıya tek sütuna
 * yığılmış bir dosya vermek, doğru olup işe yaramamaktır.
 */

/** Excel'in UTF-8'i tanıması için gereken bayt sırası işareti. */
export const UTF8_BOM = '﻿';

export const CSV_DELIMITER = ';';

/**
 * Bir alanı kaçırır.
 *
 * Tırnak, ayraç ve satır sonu içeren alanlar tırnaklanır; içerideki tırnak
 * ikilenir. `\r` de tetikleyici: Excel'in ürettiği metinlerde tek başına
 * dolaşır ve tırnaklanmazsa satırı bölerdi.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/["\r\n;]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Minor unit tamsayısını Excel'in okuyacağı ondalığa çevirir.
 *
 * Float'a HİÇ uğramaz: `1234` → `"12,34"` metin işlemiyle üretilir. `/100`
 * yapıp biçimlendirmek, 4 kuruşluk bir yuvarlama hatasını raporun tam da
 * güvenilmesi gereken yerine sokardı.
 */
export function csvMoney(minor: number, fractionDigits = 2): string {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(fractionDigits + 1, '0');
  const whole = digits.slice(0, digits.length - fractionDigits);
  const fraction = digits.slice(digits.length - fractionDigits);
  return `${negative ? '-' : ''}${whole},${fraction}`;
}

/**
 * Başlık + satırlardan tam bir CSV gövdesi.
 *
 * Satır sonu `\r\n`: Excel'in beklediği bu ve `\n` bazı sürümlerde tek satır
 * gibi okunuyor.
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [headers.map(csvField).join(CSV_DELIMITER)];
  for (const row of rows) lines.push(row.map(csvField).join(CSV_DELIMITER));
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * `Content-Disposition` için güvenli dosya adı.
 *
 * ASCII'ye indirgeniyor çünkü başlıkta Türkçe karakter `filename*` kodlaması
 * gerektirir ve tarayıcıların yarısı onu düz `filename`in üstüne yazar. Dosya
 * adı bir kimlik değil, bir kolaylık — okunur ASCII yeterli.
 */
export function csvFilename(reportName: string, from: string, to: string): string {
  const day = (iso: string): string => iso.slice(0, 10);
  // İzin verilmeyen karakterler SİLİNMİYOR, tireye çevriliyor: silmek
  // "ciro şubat"ı "ciroubat" yapar, yani iki kelimeyi birbirine yapıştırır.
  const safe = reportName
    .replaceAll(/[^a-z0-9]+/gi, '-')
    .replaceAll(/^-+|-+$/g, '')
    .toLowerCase();
  return `${safe}-${day(from)}-${day(to)}.csv`;
}
