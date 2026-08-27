/**
 * PostgreSQL hata kodu yardımcıları.
 *
 * Drizzle, sürücü hatasını kendi `DrizzleQueryError`i içine SARMALAR; PostgreSQL
 * kodu (`23505` gibi) üst seviyede değil `cause` zincirindedir. Doğrudan
 * `error.code` okunursa hiçbir eşleşme olmaz ve beklenen bir çakışma 500'e
 * dönüşür.
 *
 * Bu yardımcı Faz 3'te de kritik olacak: randevu çakışmalarında `23P01`
 * (exclusion_violation) yakalanıp `409 SLOT_CONFLICT`e çevrilecek.
 */

export const PG_ERROR = {
  /** unique_violation */
  UNIQUE_VIOLATION: '23505',
  /** exclusion_violation — EXCLUDE constraint ihlali (takvim çakışması) */
  EXCLUSION_VIOLATION: '23P01',
  /** foreign_key_violation */
  FOREIGN_KEY_VIOLATION: '23503',
  /** check_violation — ör. paket hakkı negatife düşemez */
  CHECK_VIOLATION: '23514',
  /** insufficient_privilege — RLS with-check ihlali burada da görülebilir */
  INSUFFICIENT_PRIVILEGE: '42501',
  /** restrict_violation — append-only tabloya UPDATE/DELETE denemesi */
  RESTRICT_VIOLATION: '2F004',

  // --- Klinara'ya özel SQLSTATE'ler ---
  //
  // 'K' sınıfını PostgreSQL kullanmaz, bu yüzden kendi iş kurallarımıza
  // ayırdık. Genel `check_violation`dan ayrı tutulmaları kasıtlı: aynı
  // trigger içinde hem kiracı kapsamı hem iş kuralı ihlali doğrulanıyor ve
  // ikisi istemciye TAMAMEN farklı mesajlarla dönmeli.
  /** Geçersiz randevu durum geçişi (Faz 3.1) */
  INVALID_STATUS_TRANSITION: 'K0001',
  /** Pasif hizmet/personel ile kayıt oluşturma denemesi */
  INACTIVE_SERVICE: 'K0002',
  /** Personel bu hizmette yetkin değil (Faz 3.1) */
  STAFF_NOT_COMPETENT: 'K0003',
} as const;

const PG_CODE_PATTERN = /^[0-9A-Z]{5}$/;
const MAX_CAUSE_DEPTH = 5;

/** Sarmalanmış hata zincirinde ilk geçerli PostgreSQL hata kodunu bulur. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current === null || typeof current !== 'object') return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && PG_CODE_PATTERN.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isPgError(error: unknown, code: string): boolean {
  return pgErrorCode(error) === code;
}

/** İhlal edilen constraint'in adı — hangi tekilliğin çakıştığını ayırt etmek için. */
export function pgConstraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current === null || typeof current !== 'object') return undefined;
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
