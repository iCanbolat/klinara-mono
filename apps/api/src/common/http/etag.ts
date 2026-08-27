import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../errors/app-error';

/**
 * Optimistic locking (API sözleşmesi 5.7).
 *
 * Senaryo: iki resepsiyonist aynı randevuyu aynı anda düzenler. Sürüm kontrolü
 * olmasaydı ikincisinin yazımı birincisininkini sessizce ezerdi ve kimse fark
 * etmezdi. `If-Match` bunu gürültülü bir 409'a çevirir.
 */

export function weakETag(version: number): string {
  return `W/"${version}"`;
}

/**
 * `If-Match` başlığındaki sürümü çözer.
 *
 * Başlık ZORUNLUDUR: opsiyonel olsaydı istemcinin onu göndermeyi unutması,
 * kilidin sessizce devre dışı kalması demek olurdu — yani korumanın en çok
 * gerektiği anda çalışmaması.
 */
export function requireIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim().length === 0) {
    throw new AppError(428, ERROR_CODES.VERSION_CONFLICT, 'If-Match başlığı zorunlu', {
      detail: 'Kaydı önce GET ile okuyun ve dönen ETag değerini If-Match olarak gönderin.',
    });
  }

  const match = /^(?:W\/)?"(\d+)"$/.exec(header.trim());
  if (match === null) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'If-Match başlığı geçersiz', {
      detail: 'Beklenen biçim: W/"3"',
    });
  }
  return Number(match[1]);
}

export function versionConflict(): AppError {
  return AppError.conflict(
    ERROR_CODES.VERSION_CONFLICT,
    'Kayıt siz okuduktan sonra değişti',
    { detail: 'Kaydı yeniden okuyup değişikliği tekrar uygulayın.' },
  );
}
