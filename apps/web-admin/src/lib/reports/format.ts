/**
 * Rapor biçimlendirme — saf.
 *
 * Para İSTEMCİDE HESAPLANMIYOR, yalnız biçimlendiriliyor: sunucu minor unit
 * tamsayısı gönderiyor ve buradaki tek iş onu okunur hâle getirmek. Toplam
 * almak, oran çıkarmak ya da iki sayıyı çıkarmak sunucunun işi — aksi hâlde
 * aynı sayının iki farklı yerde hesaplanan iki sürümü olurdu.
 */

const MONEY = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat('tr-TR');

/**
 * Kuruş → "1.234,56 ₺".
 *
 * Bölme burada FLOAT üretiyor ve bu kabul edilebilir: sonuç yalnız ekrana
 * gidiyor, hiçbir hesaba girmiyor. `Intl` iki basamağa yuvarluyor ve
 * 90 trilyon kuruşa kadar `Number` kayıpsız.
 */
export function formatMoney(minor: number, currency = 'TRY'): string {
  if (currency === 'TRY') return MONEY.format(minor / 100);
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** Sunucu zaten yüzde gönderiyor; burada yalnız işaret ve ayraç. */
export function formatPercent(value: number): string {
  return `%${NUMBER.format(value)}`;
}

/**
 * Dakikayı "6 sa 30 dk" biçimine çevirir.
 *
 * Ham dakika (`480`) bir insanın kafasında saate dönüşmüyor ve doluluk raporu
 * tam da "kaç saatim doluydu" sorusunun cevabı. Ham değer CSV'de duruyor.
 */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${NUMBER.format(rest)} dk`;
  if (rest === 0) return `${NUMBER.format(hours)} sa`;
  return `${NUMBER.format(hours)} sa ${NUMBER.format(rest)} dk`;
}

/**
 * Yüzde değişimi işaretiyle. `null` KIYASLANAMAZ demek.
 *
 * `null`ı "%0" diye göstermek, "değişim yok" yalanı olurdu — oysa önceki dönem
 * boş demek.
 */
export function formatDelta(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${NUMBER.format(value)}%`;
}
