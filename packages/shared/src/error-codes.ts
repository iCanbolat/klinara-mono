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
  TOKEN_INVALID: 'TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  BRANCH_FORBIDDEN: 'BRANCH_FORBIDDEN',

  // --- Giriş akışı ---
  /** Kullanıcı adı VEYA parola hatalı. İkisi bilerek ayrıştırılmaz. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** Ardışık hatalı denemeler sonrası geçici kilit. */
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** Kullanıcı birden çok kiracıda; `POST /auth/tenant` ile seçim gerekir. */
  TENANT_SELECTION_REQUIRED: 'TENANT_SELECTION_REQUIRED',
  /** İkinci faktör bekleniyor; ara `mfa` token'ı ile doğrulanmalı. */
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  /** Doğrulanmamış telefon giriş tanımlayıcısı olarak kullanılamaz. */
  PHONE_NOT_VERIFIED: 'PHONE_NOT_VERIFIED',
  PHONE_IN_USE: 'PHONE_IN_USE',
  /** SMS / e-posta doğrulama kodu hatalı, süresi dolmuş veya yanmış. */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  PASSKEY_INVALID: 'PASSKEY_INVALID',
  /** Son giriş yöntemi kaldırılamaz — kullanıcı hesabından kilitlenirdi. */
  CREDENTIAL_REQUIRED: 'CREDENTIAL_REQUIRED',
  INVITATION_INVALID: 'INVITATION_INVALID',
  /** Kendinden geniş yetkili bir rolü atama denemesi. */
  ROLE_ESCALATION: 'ROLE_ESCALATION',

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
  /** Tahsis edilen tutar kalemin bakiyesini ya da tahsilatın kendisini aşıyor. */
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',
  /** İndirim süresi dolmuş, pasif ya da kullanım hakkı tükenmiş. */
  DISCOUNT_INVALID: 'DISCOUNT_INVALID',
  /** Nakit tahsilat/iade için açık bir kasa oturumu gerekir. */
  CASH_SESSION_REQUIRED: 'CASH_SESSION_REQUIRED',
  /** Şubede zaten açık bir kasa oturumu var. */
  CASH_SESSION_ALREADY_OPEN: 'CASH_SESSION_ALREADY_OPEN',
  /** Kapatılmış prim dönemi değiştirilemez. */
  PERIOD_CLOSED: 'PERIOD_CLOSED',

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
