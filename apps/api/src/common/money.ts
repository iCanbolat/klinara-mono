/**
 * Para — tamsayı minor unit (kuruş) aritmetiği (bkz. bölüm 4.4).
 *
 * Bu dosyada float YOKTUR. Tüm işlemler `number` üzerinde tamsayı olarak
 * yapılır; `Number.MAX_SAFE_INTEGER` (~90 trilyon kuruş) bu ürünün tutarları
 * için fazlasıyla yeterli.
 */

/**
 * Bir toplamı ağırlıklara göre paylaştırır — KURUŞ KAYBI OLMADAN.
 *
 * Naif yaklaşım (`round(total * w / sumW)`) her kalemde ayrı yuvarlar ve
 * toplam tutmaz: 2999 kuruşu üç eşit kaleme bölerken 1000+1000+1000 = 3000
 * çıkar, yani hiç var olmayan 1 kuruş yaratılır. Paket satışında bu, kalem
 * tahsislerinin toplamının paketin satış fiyatına eşit olmaması demektir ve
 * yükümlülük raporunu sessizce bozar.
 *
 * Bunun yerine "largest remainder" (Hamilton) yöntemi: önce taban paylar
 * verilir, artan kuruşlar en büyük kalanı olan kalemlere birer birer
 * dağıtılır. Dönen dizinin toplamı DAİMA `total`'a eşittir.
 *
 * Ağırlıkların tamamı 0 ise (ya da dizi boşsa) toplam ilk kaleme yazılır —
 * bölüştürülecek bir oran yoktur ama para kaybolmamalıdır.
 */
export function allocateMinor(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total)) {
    throw new TypeError('allocateMinor: toplam tamsayı (minor unit) olmalı.');
  }
  if (weights.length === 0) return [];
  if (weights.some((weight) => weight < 0)) {
    throw new RangeError('allocateMinor: ağırlıklar negatif olamaz.');
  }

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) {
    return weights.map((_, index) => (index === 0 ? total : 0));
  }

  const shares = weights.map((weight) => Math.floor((total * weight) / weightSum));
  let remainder = total - shares.reduce((sum, share) => sum + share, 0);

  // Kalanı, ondalık artığı en büyük olandan başlayarak dağıt. Eşitlikte
  // düşük indeks kazanır — sonuç deterministik olmalı, aksi hâlde aynı
  // satış iki kez hesaplandığında farklı tahsis çıkabilirdi.
  const order = weights
    .map((weight, index) => ({ index, remainder: (total * weight) % weightSum }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const entry of order) {
    if (remainder <= 0) break;
    shares[entry.index] = (shares[entry.index] ?? 0) + 1;
    remainder -= 1;
  }
  return shares;
}

/**
 * Bir kalemin kalan hakkının parasal karşılığı.
 *
 * `itemTotalMinor` kalemin TAMAMININ satış değeri, `quantityTotal` toplam
 * seans sayısıdır; kalan hak için oransal pay yarım-yukarı yuvarlanır.
 * Yükümlülük raporu ve iade aynı fonksiyonu kullanır — iki yerde iki farklı
 * yuvarlama, iade edilen tutarın raporlanan borçtan farklı çıkması demekti.
 */
export function remainingValueMinor(
  itemTotalMinor: number,
  quantityTotal: number,
  remainingSessions: number,
): number {
  if (quantityTotal <= 0 || remainingSessions <= 0) return 0;
  return Math.floor((itemTotalMinor * remainingSessions * 2 + quantityTotal) / (quantityTotal * 2));
}

/**
 * Yarıyı çifte yuvarlayan tamsayı bölme (bankers rounding) — doküman 4.4'ün
 * "yuvarlama sadece tek bir yerde yapılır" kuralının o tek yeri.
 *
 * `Math.round` YETMEZ: her yarım değeri yukarı çeker ve yüzlerce kalem
 * üzerinde sistematik bir sapma biriktirir. Yarıyı çifte çekmek sapmayı
 * uzun vadede sıfıra yaklaştırır — KDV ve prim hesabında aranan davranış budur.
 *
 * Float yok: bölme, taban ve kalan üzerinden tamsayı olarak yapılır.
 */
export function roundHalfEven(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new TypeError('roundHalfEven: pay ve payda tamsayı olmalı.');
  }
  if (denominator === 0) {
    throw new RangeError('roundHalfEven: payda sıfır olamaz.');
  }

  // Paydayı pozitife normalize et; `Math.floor` negatif payda ile ters çalışır.
  const sign = denominator < 0 ? -1 : 1;
  const n = numerator * sign;
  const d = denominator * sign;

  const quotient = Math.floor(n / d);
  const remainder = n - quotient * d; // 0 <= remainder < d
  const twice = remainder * 2;

  if (twice > d) return quotient + 1;
  if (twice < d) return quotient;
  // Tam yarım: çift olana çek. (JS'te negatif `%` negatif döner; `!== 0`
  // kontrolü tek sayıyı her iki işarette de doğru yakalar.)
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

export interface VatSplit {
  netMinor: number;
  vatMinor: number;
}

/**
 * KDV DAHİL bir tutarı net + KDV olarak ayırır.
 *
 * Ürünün fiyat sözleşmesi brüttür: katalogdaki `price_minor` müşteriye söylenen
 * tutardır ("lazer 1.500 TL"), üzerine KDV eklenmez. KDV o tutarın İÇİNDEN
 * çıkarılır; bu yüzden payda `10000 + rate`, `10000` değil.
 *
 * `netMinor + vatMinor = totalMinor` her zaman sağlanır — net, KDV'nin
 * çıkarılmasıyla bulunur, ayrıca yuvarlanmaz. İki tarafı da yuvarlamak
 * toplamın brütten sapması demekti.
 */
export function splitVatInclusive(totalMinor: number, rateBasisPoints: number): VatSplit {
  if (!Number.isInteger(totalMinor)) {
    throw new TypeError('splitVatInclusive: tutar tamsayı (minor unit) olmalı.');
  }
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0) {
    throw new RangeError('splitVatInclusive: KDV oranı negatif olmayan tamsayı olmalı.');
  }

  const vatMinor = roundHalfEven(totalMinor * rateBasisPoints, 10000 + rateBasisPoints);
  return { netMinor: totalMinor - vatMinor, vatMinor };
}

export type DiscountKind = 'percent' | 'amount';

/**
 * İndirim tutarını hesaplar — TABANI AŞAMAZ.
 *
 * `percent` için `value` baz puandır (1500 = %15), `amount` için doğrudan
 * minor unit. Sonuç `[0, baseMinor]` aralığına kırpılır: kabul kriteri
 * "indirim sonrası tutar negatife düşemez" diyor ve bunu çağıranın
 * hatırlamasına bırakmak, bir gün hatırlamaması demekti.
 */
export function applyDiscount(baseMinor: number, kind: DiscountKind, value: number): number {
  if (!Number.isInteger(baseMinor) || baseMinor < 0) {
    throw new RangeError('applyDiscount: taban negatif olmayan tamsayı olmalı.');
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError('applyDiscount: indirim değeri negatif olmayan tamsayı olmalı.');
  }

  const raw = kind === 'percent' ? roundHalfEven(baseMinor * value, 10000) : value;
  return Math.min(raw, baseMinor);
}
