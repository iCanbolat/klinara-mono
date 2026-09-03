/**
 * Doğrulama yoklamasının geri çekilme takvimi — saf.
 *
 * DNS yayılımı dakikalar sürüyor; sabit aralıklı bir yoklama ya çok sık olup
 * boşuna istek üretir ya da çok seyrek olup kullanıcıyı bekletir. Geri çekilme
 * ikisini de çözüyor.
 *
 * Toplam süre SINIRLI: beş dakika sonra yoklama duruyor ve kullanıcıya bir
 * "Yenile" düğmesi gösteriliyor. Süresiz yoklama, sekmesini açık unutan bir
 * kullanıcının tarayıcısından saatlerce istek göndermek demekti.
 */

const DELAYS_MS = [5_000, 15_000, 30_000] as const;
export const MAX_POLL_MS = 5 * 60 * 1000;

/**
 * Sıradaki yoklamaya kaç ms kaldı; yoklama bitmişse `null`.
 *
 * @param attempt kaçıncı yoklama (0'dan başlar)
 * @param elapsedMs ilk yoklamadan bu yana geçen süre
 */
export function nextPollDelay(attempt: number, elapsedMs: number): number | null {
  if (elapsedMs >= MAX_POLL_MS) return null;
  const index = Math.min(attempt, DELAYS_MS.length - 1);
  return DELAYS_MS[index] ?? null;
}
