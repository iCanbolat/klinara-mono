/**
 * Platform yöneticisi oturumu — klinik oturumundan TAMAMEN ayrı.
 *
 * `PLATFORM_ADMIN_TOKEN` kiracı-üstü tek anahtardır. Tarayıcıya ASLA inmez:
 * girişte bir kez gönderilir, API'ye doğrulatılır ve mühürlü httpOnly bir
 * cookie'de (amaç `pt`, AAD'ye bağlı — klinik cookie yuvalarına replay
 * edilemez) 8 saat tutulur. Destek gerekçesi de aynı cookie'de durur ve her
 * isteğe `X-Support-Reason` olarak eklenir; API her çağrıyı
 * `platform_access_log`a bu gerekçeyle yazar.
 *
 * Saf kısım (cookie şartnamesi, yol beyaz listesi) burada; mühürleme ve
 * cookie yazımı Route Handler'larda.
 */

export const PLATFORM_COOKIE = 'klinara_platform';

/** Platform oturumunun ömrü. Kısa: anahtar her şeyi açıyor. */
export const PLATFORM_SESSION_SECONDS = 8 * 60 * 60;

export interface PlatformSessionPayload {
  /** API'nin `PLATFORM_ADMIN_TOKEN`ı. */
  token: string;
  /** Destek gerekçesi (en az 8 karakter). */
  reason: string;
  /** Unix saniye. */
  exp: number;
}

export function platformCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    // Strict: platform oturumu başka bir siteden gelen hiçbir istekte taşınmasın.
    sameSite: 'strict' as const,
    path: '/',
    maxAge: PLATFORM_SESSION_SECONDS,
  };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const PLATFORM_RULES: readonly { methods: readonly string[]; pattern: RegExp }[] = [
  { methods: ['GET', 'POST'], pattern: /^tenants$/ },
  { methods: ['GET', 'PATCH'], pattern: new RegExp(`^tenants/${UUID}$`) },
  { methods: ['POST'], pattern: new RegExp(`^tenants/${UUID}/owner-invitation$`) },
  // Elden WABA kurulumu. Test gönderimi bilerek yok (API'de de yok).
  { methods: ['GET', 'PUT'], pattern: new RegExp(`^tenants/${UUID}/whatsapp$`) },
  {
    methods: ['POST'],
    pattern: new RegExp(`^tenants/${UUID}/whatsapp/(verify|templates/provision)$`),
  },
];

/** `/api/platform/<path>` → yukarı akışta `platform/<path>`. Yalnız kiracı yönetimi. */
export function isAllowedPlatformPath(path: string, method: string): boolean {
  if (path.includes('..') || path.includes('//') || /%2f|%5c|%2e/i.test(path)) return false;
  const upper = method.toUpperCase();
  return PLATFORM_RULES.some((rule) => rule.methods.includes(upper) && rule.pattern.test(path));
}

export const MIN_REASON_LENGTH = 8;
