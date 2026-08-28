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
