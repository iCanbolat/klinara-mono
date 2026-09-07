/**
 * Log gizleme (redaction) politikası.
 *
 * İki farklı davranış var ve ayrımı önemli:
 *   - SIR (parola, token, imza): tamamen kaldırılır. Loga hiç girmemeli.
 *   - KİŞİSEL VERİ (telefon): kısmen maskelenir. Destek ekibinin "bu numara mı?"
 *     sorusunu cevaplayabilmesi için son 2 hane kalır, gerisi gizlenir.
 *
 * Sağlık verisi (alerji, tanı, anamnez) hiçbir zaman loglanmaz — bunun için
 * gizleme değil, "loglamamak" kuralı geçerlidir (bkz. Batch 4.4).
 */

/** Gizlenecek alan adları. Yeni hassas alan eklendiğinde BURAYA eklenir. */
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'accessTokenEncrypted',
  'signature',
  'tcKimlikNo',
  'nationalId',
  'phone',
  'phoneNumber',
  'customerPhone',
  // Bildirim çekirdeği (8.1): gönderim worker'ı ham adresi bellekte tutar ve
  // bir hata nesnesiyle birlikte loga düşmesi işten değildir. `to` bu yüzden
  // tamamen gizlenir — yerel SMS göndericisi zaten maskeli yazıyordu, buradaki
  // kural onun unutulduğu yolları da kapatıyor.
  'to',
  'renderedBody',
  'variables',
] as const;

/**
 * Pino'nun joker karakteri TEK seviye eşler: `*.password` yalnızca
 * `bir.password` yolunu yakalar, KÖK seviyedeki `password`'ü değil. Bu yüzden
 * her hassas anahtar için kök + 2 iç seviye yolları üretiyoruz.
 *
 * (Bu tuzağı bir test yakaladı: `*.password` tek başına yazıldığında
 * `log.info({ password })` çağrısı parolayı düz metin olarak loga yazıyordu.)
 */
const DEPTH_PREFIXES = ['', '*.', '*.*.'];

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...DEPTH_PREFIXES.flatMap((prefix) => SENSITIVE_KEYS.map((key) => `${prefix}${key}`)),
];

/** `+905321234567` → `+90**********67` */
export function maskPhone(value: string): string {
  if (value.length <= 4) return '***';
  const prefix = value.startsWith('+') ? value.slice(0, 3) : value.slice(0, 2);
  const suffix = value.slice(-2);
  return `${prefix}${'*'.repeat(Math.max(value.length - prefix.length - 2, 3))}${suffix}`;
}

/** `ayse@klinik.com` → `a***e@klinik.com` */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `${local[0] ?? '*'}***${domain}`;
  return `${local[0] ?? ''}***${local[local.length - 1] ?? ''}${domain}`;
}

const PHONE_LIKE = /phone/i;

/** Pino `redact.censor` — yola göre ya tamamen gizler ya da maskeler. */
export function censor(value: unknown, path: string[]): string {
  const leaf = path[path.length - 1] ?? '';
  if (PHONE_LIKE.test(leaf) && typeof value === 'string') {
    return maskPhone(value);
  }
  return '[GİZLENDİ]';
}

/**
 * Sırların loga ve trace'e URL ÜZERİNDEN sızdığı yol.
 *
 * Gövde loglanmıyor, `authorization` başlığı gizleniyor — ama URL'in kendisi
 * ham hâlde yazılıyordu (pino-http `req.url`, OpenTelemetry `url.full`,
 * Sentry `request.url`). Bu üç uçta taşınan şey bir kimlik bilgisidir:
 *
 *   GET /public/sites/:slug/appointments/<43 karakterlik token>
 *   GET /invitations/token/<davet token'ı>
 *   GET /uploads/local/get?sig=<imza>
 *
 * Yani "randevuyu iptal edebilen" ya da "hesabı açabilen" bir sır, log
 * toplayıcıya ve APM sağlayıcısına düz metin gidiyordu.
 *
 * Kural iki parçalı ve BİÇİME bakar, yola değil — yeni bir uç eklendiğinde
 * listeye eklenmeyi beklemez:
 *   - Yol parçası: uzun (≥ 24 karakter) ve UUID DEĞİL ise gizlenir. Kimlikler
 *     (uuid) ve slug'lar bu eşiğin altındadır; `generateOpaqueToken` 43
 *     karakterlik base64url üretir.
 *   - Sorgu parametresi: adı hassas listesindeyse VEYA değeri aynı "uzun ve
 *     UUID değil" testini geçiyorsa gizlenir.
 */
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'sig',
  'signature',
  'code',
  'otp',
  'key',
  'secret',
  'state',
  'password',
  'access_token',
  'refresh_token',
  'challenge_token',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque token eşiği: 16 baytlık bir sır bile base64url'de 22 karakterdir. */
const OPAQUE_MIN_LENGTH = 24;

function looksOpaque(value: string): boolean {
  return value.length >= OPAQUE_MIN_LENGTH && !UUID_PATTERN.test(value);
}

/** Log/trace'e yazılacak URL'i sırlarından arındırır. Yol yapısı KORUNUR. */
export function sanitizeUrl(url: string): string {
  if (url === '') return url;
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? '' : url.slice(queryAt + 1);

  const safePath = path
    .split('/')
    .map((segment) => (looksOpaque(segment) ? '[GİZLENDİ]' : segment))
    .join('/');

  if (query === '') return safePath;

  // `URLSearchParams` sırayı korur; `+` ve kodlamayı bozmamak için değerleri
  // yalnız gizlerken değiştiriyoruz.
  const params = new URLSearchParams(query);
  const safeQuery = [...params.entries()]
    .map(([key, value]) => {
      const hide = SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) || looksOpaque(value);
      return `${key}=${hide ? '[GİZLENDİ]' : value}`;
    })
    .join('&');

  return `${safePath}?${safeQuery}`;
}

/**
 * pino-http `req.params`i de loglar ve orada yol parçaları HAM durur —
 * URL'i temizleyip burayı unutmak sırrı aynı satırda bırakırdı.
 */
export function sanitizeParams(params: unknown): unknown {
  if (params === null || typeof params !== 'object') return params;
  const hide = (value: unknown): unknown =>
    typeof value === 'string' && looksOpaque(value) ? '[GİZLENDİ]' : value;
  const entries = Object.entries(params as Record<string, unknown>).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.map(hide) : hide(value),
  ]);
  return Object.fromEntries(entries);
}
