import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Opak token üretimi ve karşılaştırması.
 *
 * Kural: davet, parola sıfırlama, refresh ve SMS kodlarının hiçbiri DÜZ METİN
 * saklanmaz. Üretilen değer yalnız bir kez — gönderim anında — var olur;
 * veritabanında sha256 özeti durur. Bu değerler yüksek entropili rastgele
 * dizilerdir, dolayısıyla parolalarda gerekli olan yavaş hash (argon2) burada
 * gerekmez; sha256 hem yeterli hem de her istekte koşacak kadar ucuzdur.
 */

/** 32 baytlık (256 bit) URL-güvenli rastgele token. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Sabit zamanlı karşılaştırma — hash eşleşmesini zamanlamadan sızdırmamak için. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Kriptografik olarak güvenli sayısal kod (SMS doğrulaması, yedek kod).
 *
 * `Math.random()` KULLANILMAZ: tahmin edilebilir bir dizidir ve doğrulama
 * kodunu tahmin edilebilir yapar.
 */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/**
 * Yedek kod: `abcd-efgh-jkmn-pqrs`.
 *
 * Karıştırılması kolay karakterler (i/l/1, o/0) alfabede YOK — kod kâğıda not
 * edilip elle girilecek. 16 karakter × 31 harflik alfabe ≈ 79 bit entropi;
 * bu, sha256 ile saklanması için fazlasıyla yeterli (parolaların aksine sözlük
 * saldırısına açık bir yapısı yok).
 */
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateBackupCode(): string {
  const pick = (): string => BACKUP_ALPHABET[randomInt(0, BACKUP_ALPHABET.length)] ?? 'x';
  const group = (): string => Array.from({ length: 4 }, pick).join('');
  return `${group()}-${group()}-${group()}-${group()}`;
}

/** Yedek kod karşılaştırmasında biçim farkını (tire, büyük harf) yok sayar. */
export function normalizeBackupCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, '');
}
