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
