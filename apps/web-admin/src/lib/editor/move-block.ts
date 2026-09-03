import type { ContentBlockInput } from '@klinara/shared';

/**
 * Sıralamanın saf indirgeyicisi — editördeki HER liste bunu kullanıyor.
 *
 * Hem klavye düğmeleri ("Yukarı taşı") hem de HTML5 sürükle-bırak BURAYA
 * akıyor. Tek bir saf fonksiyon olması, erişilebilir yolun (düğmeler) ve
 * kolaylık yolunun (sürükleme) aynı davranışı üretmesini garanti ediyor —
 * iki ayrı uygulama, iki ayrı hata demekti.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  // Hedef sınırlara KIRPILIYOR, reddedilmiyor: en üstteki bloğun "yukarı"
  // düğmesine basmak bir hata değil, sadece bir şey yapmayan bir eylem.
  const target = Math.max(0, Math.min(to, next.length - 1));
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(target, 0, moved);
  return next;
}

/**
 * Blok sıralaması. Karusel ögeleri de AYNI indirgeyiciyi (`moveItem`) kullanıyor:
 * iki listenin sınır davranışı (kırpma, boş liste, aralık dışı indis) ayrı ayrı
 * yazılsaydı ikisinden biri er geç diğerinden farklı davranırdı.
 */
export function moveBlock(
  sections: readonly ContentBlockInput[],
  from: number,
  to: number,
): ContentBlockInput[] {
  return moveItem(sections, from, to);
}

export function removeBlock(
  sections: readonly ContentBlockInput[],
  index: number,
): ContentBlockInput[] {
  return sections.filter((_, position) => position !== index);
}

export function replaceBlock(
  sections: readonly ContentBlockInput[],
  index: number,
  block: ContentBlockInput,
): ContentBlockInput[] {
  return sections.map((section, position) => (position === index ? block : section));
}

/** Yukarı/aşağı taşımanın mümkün olup olmadığı — düğme durumunu belirliyor. */
export function canMove(length: number, index: number, direction: -1 | 1): boolean {
  const target = index + direction;
  return target >= 0 && target < length;
}
