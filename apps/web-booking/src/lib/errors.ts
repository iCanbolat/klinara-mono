import { ERROR_CODES } from '@klinara/shared';
import { ApiProblemError } from '@/lib/problem';

/**
 * Hata kodu → KULLANICIYA NE OLDUĞU ve AKIŞIN NE YAPACAĞI.
 *
 * Ayrı bir `recovery` alanı var çünkü mesaj tek başına yetmiyor: "bu saat az
 * önce doldu" demek, saat listesini tazelemeden kullanıcıyı aynı ölü slotla
 * baş başa bırakır. Kurtarma adımı metnin yanında durmazsa biri eklenmeyi
 * unutulur.
 */
export type Recovery =
  | 'none'
  | 'refresh-slots'
  | 'reset-hold'
  | 'release-and-retry'
  | 'go-identity'
  | 'lock-otp'
  | 'highlight-consent'
  | 'countdown'
  | 'field-errors'
  | 'expired-link';

export interface UserFacingError {
  message: string;
  recovery: Recovery;
  /** Hız sınırı / OTP kilidi için saniye. */
  retryAfterSeconds: number | null;
  /** Destek için; ekranda küçük puntoda. */
  requestId: string | null;
  fieldErrors: { path: string; message: string }[];
}

const MESSAGES: Record<string, { message: string; recovery: Recovery }> = {
  [ERROR_CODES.SLOT_CONFLICT]: {
    message: 'Bu saat az önce doldu. Uygun saatleri yeniledik.',
    recovery: 'refresh-slots',
  },
  [ERROR_CODES.SLOT_TOKEN_INVALID]: {
    message: 'Seçtiğiniz saat artık geçerli değil. Lütfen yeniden seçin.',
    recovery: 'refresh-slots',
  },
  [ERROR_CODES.STAFF_REF_INVALID]: {
    message: 'Seçtiğiniz uygulayıcı artık uygun değil. Listeyi yeniledik.',
    recovery: 'refresh-slots',
  },
  [ERROR_CODES.HOLD_INVALID]: {
    message: 'Seçiminiz kayboldu. Lütfen saati yeniden seçin.',
    recovery: 'reset-hold',
  },
  [ERROR_CODES.HOLD_EXPIRED]: {
    message: 'Saati tutma süresi doldu. Uygun saatleri yeniledik.',
    recovery: 'reset-hold',
  },
  [ERROR_CODES.HOLD_LIMIT_REACHED]: {
    message: 'Aynı anda birden fazla saat tutamazsınız.',
    recovery: 'release-and-retry',
  },
  [ERROR_CODES.OTP_REQUIRED]: {
    message: 'Devam etmek için telefon numaranızı doğrulamanız gerekiyor.',
    recovery: 'go-identity',
  },
  [ERROR_CODES.OTP_LOCKED]: {
    message: 'Çok fazla hatalı deneme yaptınız. Yeni bir kod isteyin.',
    recovery: 'lock-otp',
  },
  [ERROR_CODES.VERIFICATION_FAILED]: {
    message: 'Kod hatalı ya da süresi dolmuş. Tekrar deneyin.',
    recovery: 'none',
  },
  [ERROR_CODES.CONSENT_REQUIRED]: {
    message: 'Devam etmek için zorunlu onayı işaretlemeniz gerekiyor.',
    recovery: 'highlight-consent',
  },
  [ERROR_CODES.CANCEL_WINDOW_CLOSED]: {
    message: 'İptal süresi geçti. Lütfen kliniği arayın.',
    recovery: 'none',
  },
  [ERROR_CODES.BOOKING_TOKEN_INVALID]: {
    message: 'Bu bağlantı geçersiz ya da süresi dolmuş.',
    recovery: 'expired-link',
  },
  [ERROR_CODES.RATE_LIMITED]: {
    message: 'Çok fazla deneme yaptınız. Lütfen biraz bekleyin.',
    recovery: 'countdown',
  },
  [ERROR_CODES.VALIDATION_FAILED]: {
    message: 'Girdiğiniz bilgilerde eksik ya da hatalı alanlar var.',
    recovery: 'field-errors',
  },
  [ERROR_CODES.IDEMPOTENCY_CONFLICT]: {
    message: 'Bu istek farklı bilgilerle zaten gönderilmiş. Sayfayı yenileyin.',
    recovery: 'reset-hold',
  },
  [ERROR_CODES.NOT_FOUND]: {
    message: 'Aradığınız kayıt bulunamadı.',
    recovery: 'none',
  },
};

const FALLBACK = 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.';

export function describeError(error: unknown): UserFacingError {
  if (!(error instanceof ApiProblemError)) {
    return {
      message: FALLBACK,
      recovery: 'none',
      retryAfterSeconds: null,
      requestId: null,
      fieldErrors: [],
    };
  }

  const known = MESSAGES[error.code];
  return {
    message: known?.message ?? FALLBACK,
    recovery: known?.recovery ?? 'none',
    retryAfterSeconds: error.retryAfterSeconds,
    requestId: error.problem.requestId === '' ? null : error.problem.requestId,
    fieldErrors: error.problem.errors ?? [],
  };
}

/** Bu kodlardan sonra tutulan hold artık yaşamıyor demektir. */
export function invalidatesHold(error: unknown): boolean {
  if (!(error instanceof ApiProblemError)) return false;
  return (
    error.code === ERROR_CODES.HOLD_INVALID ||
    error.code === ERROR_CODES.HOLD_EXPIRED ||
    error.code === ERROR_CODES.IDEMPOTENCY_CONFLICT
  );
}
