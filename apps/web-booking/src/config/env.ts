/**
 * Uygulamanın TEK `process.env` okuyucusu.
 *
 * Repo genelinde `no-restricted-properties` doğrudan `process.env` erişimini
 * yasaklıyor ve yalnız `**\/src/config/*.ts`'i muaf tutuyor (`eslint.config.js`).
 * Kural API'den geliyor ama burada da doğru: hangi değerin tarayıcıya indiğini
 * tek dosyadan okumak, bir sırrın yanlışlıkla `NEXT_PUBLIC_` önekiyle
 * yayınlanmasını fark edilir kılıyor.
 *
 * ⚠️ `NEXT_PUBLIC_*` değerleri BİREBİR `process.env.NEXT_PUBLIC_X` ifadesi
 * olarak okunmak zorunda: Next bu ifadeleri derleme sırasında metin olarak
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
  /** Next route handler proxy'sinin yukarı akış adresi (API_PREFIX dâhil). */
  apiInternalUrl: (
    process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1'
  ).replace(/\/$/, ''),
  /** Purge-on-publish ucunun paylaşılan sırrı. Boşsa uç 503 döner. */
  revalidateSecret: process.env.WEB_REVALIDATE_SECRET ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;

/** Tarayıcıya inlenen değerler. Sır KOYULMAZ. */
export const publicEnv = {
  bookingDomain: process.env.NEXT_PUBLIC_BOOKING_DOMAIN ?? 'klinara.localhost',
  assetBaseUrl: (process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '').replace(/\/$/, ''),
  /** Yerelde konak adı çözümlemesini atlamak için; üretimde yok sayılır. */
  devSlug: process.env.NEXT_PUBLIC_DEV_SLUG ?? '',
} as const;

export const isProduction = serverEnv.nodeEnv === 'production';

/** Üretimde eksik yapılandırmayı açılışta patlat — sessiz kırık sayfa yerine. */
export function assertServerEnv(): void {
  required('API_INTERNAL_URL', process.env.API_INTERNAL_URL);
}
