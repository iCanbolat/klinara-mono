/**
 * Çakışan randevuların ızgarada yan yana yerleştirilmesi — saf, React'siz.
 *
 * Takvim ızgarasının tek gerçekten zor parçası bu. Bir kütüphane (FullCalendar,
 * react-big-calendar) bunu da getirirdi ama ikisi de kabul edilemezdi:
 * FullCalendar'ın personel sütunu görünümü ticari lisanslı, react-big-calendar
 * ise reddettiğimiz tarih kütüphanesini geri getiriyor. Buradaki iş ~40 satır
 * ve doğruluğu bir kütüphanenin görsel çıktısına bakarak değil, iddia yazarak
 * biliniyor.
 *
 * ---------------------------------------------------------------------------
 * ALGORİTMA
 * ---------------------------------------------------------------------------
 * 1. Başlangıca göre sırala (eşitlikte uzun olan önce — kısa bir randevu
 *    uzun olanın soluna düşerse şerit sayısı gereksiz artar).
 * 2. Soldan sağa boş şerit ara; her şeritte o şeritteki SON kaydın bitişi
 *    tutuluyor, dolayısıyla arama O(şerit sayısı).
 * 3. Bir "çakışma kümesi" (birbirine zincirle bağlı, kesişen kayıtlar
 *    topluluğu) boyunca `laneCount` AYNI olmalı: aynı kümedeki iki kayıt
 *    farklı genişlikte çizilirse ızgarada boşluk ya da taşma olur. Bu yüzden
 *    küme kapandığında geriye dönüp herkese kümenin genişliği yazılıyor.
 *
 * Adım 3 en kolay atlanan yer: şerit ataması tek geçişte yapılabilir ama
 * genişlik ancak küme bittiğinde bilinir.
 */

export interface LayoutInput {
  id: string;
  /** Gün içi dakika (0–1439). `minutesOfDay` üretir. */
  startMin: number;
  endMin: number;
}

export interface LayoutResult {
  id: string;
  /** 0 tabanlı sütun indeksi. */
  lane: number;
  /** Bu kaydın ait olduğu çakışma kümesindeki toplam şerit sayısı. */
  laneCount: number;
}

/**
 * Sıfır ve negatif süreli kayıtlar için asgari görsel yükseklik.
 *
 * Sıfır süreli bir kayıt hiçbir şeyle "kesişmez" (yarı açık aralıkta boş
 * küme) ve kendi başına bir şeride düşerdi; kullanıcıya görünmez bir blok
 * olarak çizilirdi. Bir dakikalık taban hem görünür kılıyor hem de komşusuyla
 * doğru şekilde çakıştırıyor.
 */
const MIN_SPAN_MINUTES = 1;

export function layoutLanes(entries: readonly LayoutInput[]): LayoutResult[] {
  if (entries.length === 0) return [];

  const normalized = entries.map((entry) => ({
    id: entry.id,
    startMin: entry.startMin,
    endMin: Math.max(entry.endMin, entry.startMin + MIN_SPAN_MINUTES),
  }));

  normalized.sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    // Eşit başlangıçta UZUN olan önce: kısa olan uzunun soluna düşerse
    // gereksiz bir şerit daha açılır.
    if (a.endMin !== b.endMin) return b.endMin - a.endMin;
    // Kararlılık: aynı aralıktaki iki kayıt her koşumda aynı sırayı almalı,
    // yoksa yeniden render'da bloklar yer değiştirir.
    return a.id < b.id ? -1 : 1;
  });

  const result: LayoutResult[] = [];
  /** Şerit başına o şeritteki son kaydın bitişi. */
  let laneEnds: number[] = [];
  /** İçinde bulunulan çakışma kümesinin `result` içindeki başlangıç indeksi. */
  let clusterStart = 0;
  /** Kümedeki hiçbir kaydın geçmediği en erken an. */
  let clusterEnd = -Infinity;

  const closeCluster = (): void => {
    const width = laneEnds.length;
    for (let i = clusterStart; i < result.length; i += 1) {
      const row = result[i];
      if (row !== undefined) row.laneCount = width;
    }
  };

  for (const entry of normalized) {
    // Küme kapandı mı: bu kayıt, kümedeki HİÇBİR kayıtla kesişmiyorsa yeni
    // bir küme başlar. Yarı açık aralık: `start >= clusterEnd` kesişmez.
    if (entry.startMin >= clusterEnd && result.length > 0) {
      closeCluster();
      clusterStart = result.length;
      laneEnds = [];
      clusterEnd = -Infinity;
    }

    let lane = laneEnds.findIndex((end) => end <= entry.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(entry.endMin);
    } else {
      laneEnds[lane] = entry.endMin;
    }

    result.push({ id: entry.id, lane, laneCount: 1 });
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }

  closeCluster();
  return result;
}
