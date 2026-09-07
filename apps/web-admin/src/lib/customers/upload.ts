import { ERROR_CODES } from '@klinara/shared';
import { ApiProblemError } from '@/lib/api/client';

/**
 * Dosya yükleme ve indirme kararlarının saf kısmı.
 *
 * Ağ çağrıları bileşende; buradaki iş **kararlar**, çünkü kararlar test
 * edilebilir olmalı ve üçü de sessizce yanlış yapılabilecek cinsten.
 */

export const FILE_KINDS = ['photo', 'document'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_POSITIONS = ['before', 'after', 'other'] as const;
export type FilePosition = (typeof FILE_POSITIONS)[number];

/**
 * Sunucunun beyaz listesi (`file.dto.ts:ALLOWED_MIME_TYPES`).
 *
 * İstemci ÖNDEN denetliyor: kullanıcıya "sunucu reddetti" demek yerine dosya
 * seçerken söylemek gerek. `image/svg+xml` bilinçli olarak YOK — SVG
 * çalıştırılabilir içerik taşır.
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

export function isAllowedType(contentType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(contentType);
}

/** MIME tipinden dosya türü; sunucunun `kind` alanı için. */
export function kindOf(contentType: string): FileKind {
  return contentType === 'application/pdf' ? 'document' : 'photo';
}

/**
 * `thumb` isteği 409 aldığında ne yapılacak.
 *
 * Sunucu küçük görsel HAZIR DEĞİLKEN sessizce tam boyuta düşmüyor, 409
 * veriyor — gerekçesi `file.dto.ts`te yazılı: 25 MB'lık bir nesneyi ızgaraya
 * indirmek istenmiyor.
 *
 * İstemcinin doğru yanıtı KIRIK GÖRSEL GÖSTERMEK DEĞİL: 409'u yakalayıp
 * `original`a düşmek. Kullanıcı için fark yok; fark yalnız indirilen bayt.
 */
export function shouldFallbackToOriginal(caught: unknown, variant: string): boolean {
  if (variant !== 'thumb') return false;
  if (!(caught instanceof ApiProblemError)) return false;
  return caught.problem.status === 409 || caught.code === ERROR_CODES.CONFLICT;
}

/**
 * İndirme adresi ÖNBELLEĞE alınmalı mı ve ne kadar.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ HER ÇAĞRI BİR KVKK ERİŞİM KAYDI YAZIYOR
 * ---------------------------------------------------------------------------
 * `GET /files/:id/download-url` her çağrıda `customer_record_access_log`a
 * satır atıyor. İstemci bu adresi liste RENDER'INDA çekerse, bir liste
 * kaydırması onlarca sahte "görüntüledi" kaydı üretir ve erişim kaydının
 * değerini SIFIRLAR — "kim hangi kaydı gördü" sorusu artık cevaplanamaz.
 *
 * Bu yüzden iki kural:
 *   1. Adres yalnız kullanıcı indirme/önizleme EYLEMİNİ tetiklediğinde
 *      çekilir.
 *   2. Sonuç kısa ömürlü olarak bellekte tutulur; yeniden render adresi
 *      tekrar çekmez.
 *
 * TTL sunucunun verdiği `expiresAt`ten türetiliyor, sabit bir sayı değil:
 * sabit bir değer sunucunun `S3_PRESIGN_TTL_SECONDS` ayarıyla ayrışırdı ve
 * süresi dolmuş bir adres kullanıcıya kırık bir bağlantı olarak görünürdü.
 */
export function cacheUntil(expiresAt: string, now: number = Date.now()): number {
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return now;
  // Güvenlik payı: adres tam sınırda kullanılırsa yolda süresi dolabilir.
  return Math.max(now, expiry - 30_000);
}

export function isCacheValid(cachedUntil: number | undefined, now: number = Date.now()): boolean {
  return cachedUntil !== undefined && cachedUntil > now;
}
