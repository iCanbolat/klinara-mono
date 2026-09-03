/**
 * Oturum cookie'lerinin mühürlenmesi — AES-256-GCM, bağımlılıksız.
 *
 * NEDEN WebCrypto, neden `node:crypto` ya da `jose` değil:
 *
 * 1. **Edge zorunluluğu.** `middleware.ts` Edge runtime'da koşuyor ve orada
 *    `node:crypto`'nun `createCipheriv`'i YOK. `globalThis.crypto.subtle` ise
 *    Node 22'de de Edge'de de aynı şekilde var. Middleware'in erişim
 *    cookie'sini açabilmesi bu seçimi tek başına belirliyor.
 * 2. **AAD asıl istediğimiz güvenlik özelliği** ve `subtle.encrypt`'in birinci
 *    sınıf parametresi. `purpose` ('at' | 'rt' | 'ch') ek doğrulanmış veri
 *    olarak bağlandığı için mühürlü bir YENİLEME cookie'si fiziksel olarak
 *    erişim cookie'si yuvasına replay edilemez — anahtar aynı olsa bile
 *    çözülmez. `jose` ile aynı özelliği almak özel başlık uğraşı isterdi.
 * 3. Repo zaten kendi i18n'ini, kendi env okuyucusunu ve kendi proxy beyaz
 *    listesini yazmış. Burada eklenecek bir bağımlılık, tamamen kontrol
 *    ettiğimiz simetrik bir mührü sarmalamaktan ibaret olurdu.
 *
 * Tel biçimi: `<keyId>.<iv_b64url>.<ciphertext_b64url>` (GCM etiketi şifreli
 * metnin sonuna eklidir — WebCrypto bunu kendisi yapar).
 */

import { serverEnv } from '@/config/env';

/** Mühür amaçları — AAD'ye girer, bu yüzden yuvalar arası replay imkânsız. */
export type SealPurpose = 'at' | 'rt' | 'ch';

const IV_BYTES = 12;
const ALGORITHM = 'AES-GCM';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Anahtar içe aktarımı pahalı; anahtar başına bir kez yapılıp saklanıyor. */
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secretBase64: string): Promise<CryptoKey> {
  const cached = keyCache.get(secretBase64);
  if (cached !== undefined) return cached;

  const promise = (async () => {
    const raw = base64ToBytes(secretBase64);
    if (raw.byteLength !== 32) {
      throw new Error(
        `ADMIN_SESSION_SECRET 32 bayt (base64) olmalı, ${String(raw.byteLength)} bayt geldi. Üretmek için: openssl rand -base64 32`,
      );
    }
    return crypto.subtle.importKey('raw', raw as BufferSource, ALGORITHM, false, [
      'encrypt',
      'decrypt',
    ]);
  })();

  keyCache.set(secretBase64, promise);
  return promise;
}

function additionalData(keyId: string, purpose: SealPurpose): Uint8Array {
  return encoder.encode(`${keyId}:${purpose}`);
}

/**
 * Değeri mühürle. Her zaman GEÇERLİ anahtarla yazılır.
 *
 * @throws anahtar yapılandırılmamışsa — şifresiz cookie yazmaktansa patlamak
 * doğru; sessiz düşüş burada tüm mimariyi anlamsız kılardı.
 */
export async function seal(value: unknown, purpose: SealPurpose): Promise<string> {
  if (serverEnv.sessionSecret === '') {
    throw new Error('ADMIN_SESSION_SECRET tanımsız — oturum cookie’si mühürlenemez.');
  }
  const key = await importKey(serverEnv.sessionSecret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encoder.encode(JSON.stringify(value));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: iv as BufferSource,
      additionalData: additionalData(serverEnv.sessionKeyId, purpose) as BufferSource,
    },
    key,
    plaintext,
  );

  return `${serverEnv.sessionKeyId}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

/**
 * Mührü aç. Başarısızlığın HER TÜRÜ `null` döner — kurcalanmış, yanlış amaçla
 * yazılmış, yanlış anahtarla mühürlenmiş, bozuk ya da JSON olmayan içerik
 * arasında çağırana ayrım sunmuyoruz: hepsinin doğru cevabı aynı, "bu cookie
 * yokmuş gibi davran". Ayrım sunmak, bir saldırgana kendi tahminlerini
 * daraltma imkânı vermekti.
 *
 * Rotasyon: token kendi `keyId`'sini taşır ve AAD ondan türetilir, bu yüzden
 * önceki anahtarla mühürlenmiş cookie'ler geçiş boyunca açılmaya devam eder.
 */
export async function unseal<T>(token: string, purpose: SealPurpose): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [keyId, ivPart, ctPart] = parts;
  if (keyId === undefined || ivPart === undefined || ctPart === undefined) return null;
  if (keyId === '' || ivPart === '' || ctPart === '') return null;

  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = base64UrlToBytes(ivPart);
    ciphertext = base64UrlToBytes(ctPart);
  } catch {
    return null;
  }
  if (iv.byteLength !== IV_BYTES) return null;

  const secrets = [serverEnv.sessionSecret, serverEnv.sessionSecretPrevious].filter(
    (secret) => secret !== '',
  );

  for (const secret of secrets) {
    try {
      const key = await importKey(secret);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: ALGORITHM,
          iv: iv as BufferSource,
          additionalData: additionalData(keyId, purpose) as BufferSource,
        },
        key,
        ciphertext as BufferSource,
      );
      return JSON.parse(decoder.decode(plaintext)) as T;
    } catch {
      // Bu anahtarla olmadı — sıradakini dene. Anahtar listesi bittiğinde null.
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// base64 yardımcıları
//
// `Buffer` KULLANILMIYOR: Edge runtime'da yok. `atob`/`btoa` her iki runtime'da
// da var ve girdi boyutları (32 bayt anahtar, ~1 kB cookie) yığın taşırma
// sınırının çok altında.
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
