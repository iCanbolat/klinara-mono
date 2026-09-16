/**
 * Kuruş ↔ metin dönüşümü.
 *
 * ---------------------------------------------------------------------------
 * NEDEN AYRI BİR DOSYA
 * ---------------------------------------------------------------------------
 * Sunucudaki her para alanı `*_minor` ve `bigint`: fiyat 500 TL ise
 * `priceMinor` 50000. Bu dönüşümün her formda tekrar yazılması, `* 100`un
 * bir yerde `parseFloat` ile yapılması demek — ve `parseFloat('12.10') * 100`
 * JavaScript'te **1209.9999999999998** eder. Bir kuruşluk kayma fiyat
 * listesinde görünmez ama ciro toplamında görünür.
 *
 * Bu yüzden dönüşüm TAMSAYI aritmetiğiyle, tek yerde.
 */

/** Kuruş → görüntüleme metni: `50000` → `'500,00'`. */
export function minorToInput(minor: number): string {
  if (!Number.isFinite(minor)) return '';
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const lira = Math.floor(abs / 100);
  const kurus = abs % 100;
  return `${negative ? '-' : ''}${String(lira)},${String(kurus).padStart(2, '0')}`;
}

/**
 * Metin → kuruş. Ayrıştırılamıyorsa `null`.
 *
 * Hem `,` hem `.` ondalık ayıracı kabul ediliyor: kullanıcı Türkçe klavyede
 * virgül, sayısal tuş takımında nokta yazar ve ikisini de kabul etmemek
 * "girdiğim fiyat kaydolmuyor" demektir.
 *
 * Binlik ayıracı (`1.234,56` ya da `1,234.56`) BİLEREK desteklenmiyor:
 * `1.234` girdisinin "bin iki yüz otuz dört" mü "bir tam iki üç dört" mü
 * olduğu belirsiz ve yanlış tahmin, fiyatı bin katına çıkarır.
 */
export function inputToMinor(text: string): number | null {
  const trimmed = text.trim().replace(/\s/g, '');
  if (trimmed === '') return null;

  const normalized = trimmed.replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(normalized)) return null;

  const negative = normalized.startsWith('-');
  const [whole = '0', fraction = ''] = normalized.replace('-', '').split('.');

  const lira = Number.parseInt(whole, 10);
  // `padEnd`: `'5'` → `'50'` (elli kuruş), `'5'` değil (beş kuruş).
  const kurus = Number.parseInt(fraction.padEnd(2, '0'), 10);
  if (Number.isNaN(lira) || Number.isNaN(kurus)) return null;

  // TAMSAYI aritmetiği — `parseFloat(...) * 100` kuruş kaydırır.
  const minor = lira * 100 + kurus;
  return negative ? -minor : minor;
}

/** Salt okunur gösterim: `50000` → `'500,00 ₺'`. */
export function formatMoney(minor: number, currency = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}
