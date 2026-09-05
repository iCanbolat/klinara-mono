import { ApiProblemError, SessionExpiredError } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';

/**
 * Hata → kullanıcıya gösterilecek metin.
 *
 * Bu yardımcı, mevcut sayfaların her birinde tekrarlanan yerel `toMessage`ın
 * paylaşılan hâli. Beş rapor sayfası aynı üç satırı altıncı kez kopyalamayı
 * hak etmiyordu.
 *
 * `SessionExpiredError` `null` dönüyor: oturum bitişini `SessionProvider`
 * yakalayıp bir MODAL açıyor ve aynı olayı bir de sayfa içinde kırmızı bir
 * satır olarak göstermek, kullanıcıya iki farklı sorun varmış gibi görünürdü.
 */
export function toMessage(caught: unknown): string | null {
  if (caught instanceof SessionExpiredError) return null;
  if (caught instanceof ApiProblemError) {
    return describeProblem(caught.problem, caught.retryAfterSeconds).message;
  }
  return networkError().message;
}
