/**
 * Dönem matematiği — saf, veritabanına ve isteğe bağlı değil.
 *
 * `CompareMode` ve `COMPARE_MODES` burada DEĞİL, `@klinara/shared`te: onları
 * istemci de okuyor.
 *
 * İki iş yapıyor: yarı açık aralığı **önceki** eşdeğerine kaydırmak (dönemsel
 * karşılaştırma) ve iki ölçüm arasındaki değişimi hesaplamak.
 */

/** Yarı açık aralık `[from, to)`. */
export interface Period {
  from: Date;
  to: Date;
}

export function toPeriod(from: string, to: string): Period {
  return { from: new Date(from), to: new Date(to) };
}

/**
 * Hemen önceki, AYNI UZUNLUKTA pencere.
 *
 * "Bir önceki ay" DEĞİL: takvim ayları eşit uzunlukta olmadığı için 28 günlük
 * şubatı 31 günlük ocakla kıyaslamak doluluğu yapay olarak düşürürdü.
 * Kullanıcı ay kıyaslamak isterse iki isteği kendi pencereleriyle atar; bu
 * fonksiyonun sözü "aynı uzunlukta, hemen bitişik".
 */
export function previousPeriod(period: Period): Period {
  const span = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - span),
    to: new Date(period.from.getTime()),
  };
}

/**
 * Yüzde değişim — `null` "kıyaslanamaz" demektir, `0` değil.
 *
 * Önceki dönem sıfırsa artış sonsuzdur ve `0` yazmak "değişim yok" yalanı
 * olurdu; istemci `null`ı "yeni" diye gösterir. Nokta duyarlığı ikiye
 * yuvarlanıyor, aksi hâlde 33.33333333333333 gibi bir sayı JSON'a girerdi.
 */
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

/**
 * Bir aralığın kapsadığı gün sayısı (üst sınır kontrolü için).
 *
 * Yaz saati geçişini umursamaz — burada amaç "bu sorgu ne kadar büyük"
 * sorusuna yaklaşık ama ucuz bir cevap vermek, takvim doğruluğu değil.
 */
export function approximateDays(period: Period): number {
  return Math.ceil((period.to.getTime() - period.from.getTime()) / 86_400_000);
}
