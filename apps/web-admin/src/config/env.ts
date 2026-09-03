/**
 * Uygulamanın TEK `process.env` okuyucusu.
 *
 * Repo genelinde `no-restricted-properties` doğrudan `process.env` erişimini
 * yasaklıyor ve yalnız `**\/src/config/*.ts`'i muaf tutuyor (`eslint.config.js`).
 * Burada gerekçe web-booking'dekinden bir kat daha ağır: bu uygulama oturum
 * mühürleme anahtarı taşıyor ve o anahtarın yanlışlıkla `NEXT_PUBLIC_` önekiyle
 * yayınlanması, tüm BFF mimarisini tek satırda anlamsız kılar.
 *
 * ⚠️ `NEXT_PUBLIC_*` değerleri BİREBİR `process.env.NEXT_PUBLIC_X` ifadesi
 * olarak okunmak zorunda: Next bunları derleme sırasında metin olarak
 * değiştiriyor, `process.env[key]` biçimindeki dinamik erişim tarayıcıda
 * `undefined` döner.
 */

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Zorunlu ortam değişkeni eksik: ${name}`);
    }
    return '';
  }
  return value;
}

/** Yalnız sunucuda okunur. Tarayıcı bundle'ına GİRMEZ. */
export const serverEnv = {
  /** Route Handler proxy'sinin yukarı akış adresi (API_PREFIX dâhil). */
  apiInternalUrl: (process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1').replace(
    /\/$/,
    '',
  ),
  /**
   * Oturum cookie'lerini mühürleyen AES-256-GCM anahtarı (32 bayt, base64).
   *
   * Boşsa uygulama üretimde açılışta patlar; yerelde `assertServerEnv()`
   * çağrılmadığı sürece boş geçer ve mühürleme katmanı anlaşılır bir hata
   * fırlatır — sessizce şifresiz cookie yazmaktansa gürültülü kırılmak doğru.
   */
  sessionSecret: process.env.ADMIN_SESSION_SECRET ?? '',
  /** Anahtar kimliği — mühür ön ekine yazılır, rotasyonu mümkün kılar. */
  sessionKeyId: process.env.ADMIN_SESSION_KEY_ID ?? 'v1',
  /**
   * Rotasyon sırasında YALNIZ açmak için kullanılan önceki anahtar.
   *
   * Yeni anahtara geçerken eski cookie'lerin bir anda geçersizleşmesi, tüm
   * kullanıcıların aynı anda girişe düşmesi demekti.
   */
  sessionSecretPrevious: process.env.ADMIN_SESSION_SECRET_PREVIOUS ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;

/** Tarayıcıya inlenen değerler. Sır KOYULMAZ. */
export const publicEnv = {
  /** Önizleme iframe'inin yükleneceği web-booking adresi. */
  bookingPreviewOrigin: (process.env.NEXT_PUBLIC_BOOKING_PREVIEW_ORIGIN ?? '').replace(/\/$/, ''),
  /** Bu uygulamanın kendi origin'i — iframe `postMessage` hedefi olarak gider. */
  adminOrigin: (process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? '').replace(/\/$/, ''),
  /** Varlık galerisinin URL kökü; `storageKey` ile birleştirilir. */
  assetBaseUrl: (process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '').replace(/\/$/, ''),
} as const;

export const isProduction = serverEnv.nodeEnv === 'production';

/** Üretimde eksik yapılandırmayı açılışta patlat — sessiz kırık oturum yerine. */
export function assertServerEnv(): void {
  required('API_INTERNAL_URL', process.env.API_INTERNAL_URL);
  required('ADMIN_SESSION_SECRET', process.env.ADMIN_SESSION_SECRET);
  required('NEXT_PUBLIC_ADMIN_ORIGIN', process.env.NEXT_PUBLIC_ADMIN_ORIGIN);
}
