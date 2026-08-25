/**
 * Makine okunur hata kodları — RFC 9457 yanıtlarındaki `code` alanı.
 *
 * İstemciler BU değerlere göre dallanır. `title`/`detail` insan içindir ve
 * serbestçe değişebilir; buradaki değerler ise sözleşmedir, değiştirilemez.
 * Yeni kod eklemek serbest, mevcut bir kodu yeniden adlandırmak kırıcı değişikliktir.
 */
export const ERROR_CODES = {
  // --- Genel ---
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // --- Kimlik & yetki ---
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  BRANCH_FORBIDDEN: 'BRANCH_FORBIDDEN',

  // --- Takvim ---
  SLOT_CONFLICT: 'SLOT_CONFLICT',
  RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
  OUTSIDE_WORKING_HOURS: 'OUTSIDE_WORKING_HOURS',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',

  // --- Paket / seans ---
  PACKAGE_EXHAUSTED: 'PACKAGE_EXHAUSTED',
  PACKAGE_EXPIRED: 'PACKAGE_EXPIRED',

  // --- Tıbbi & onam ---
  CONTRAINDICATION_BLOCK: 'CONTRAINDICATION_BLOCK',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',

  // --- Finans ---
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',

  // --- Eş zamanlılık ---
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',

  // --- İletişim ---
  OPT_OUT: 'OPT_OUT',

  // --- Kiracılık ---
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
  CONFLICT: 'CONFLICT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
