import { ERROR_CODES, type ProblemDetails } from '@klinara/shared';
import { t, type MessageKey } from '@/i18n/tr';

/**
 * RFC 9457 problem belgesini kullanıcıya gösterilebilir metne çevirir.
 *
 * Sunucunun `title`/`detail` alanları Türkçe ve çoğu zaman iyi; ama bazıları
 * geliştiriciye yazılmış ("X-Branch-Id başlığı zorunlu") ve kullanıcıya
 * gösterilemez. Bu yüzden BİLDİĞİMİZ kodlar için kendi metnimizi kullanıyor,
 * bilmediklerimizde sunucununkine düşüyoruz — tersi olsaydı yeni bir hata kodu
 * eklendiğinde kullanıcı boş bir kutu görürdü.
 */

export interface UserFacingError {
  message: string;
  /** Destek talebinde işe yarayan izleme kimliği. */
  requestId: string | null;
  /** Alan bazlı doğrulama hataları — form altına basılıyor. */
  fieldErrors: { path: string; message: string }[];
  retryAfterSeconds: number | null;
  /** Oturum öldü mü — arayüz kurtarma modalını buna göre açıyor. */
  sessionEnded: boolean;
}

const MESSAGE_BY_CODE: Partial<Record<string, MessageKey>> = {
  [ERROR_CODES.FORBIDDEN]: 'error.forbidden',
  [ERROR_CODES.NOT_FOUND]: 'error.notFound',
  [ERROR_CODES.INVALID_CREDENTIALS]: 'error.invalidCredentials',
  [ERROR_CODES.ACCOUNT_LOCKED]: 'error.accountLocked',
  [ERROR_CODES.MFA_INVALID]: 'error.mfaInvalid',
  [ERROR_CODES.HOST_TAKEN]: 'domains.hostTaken',
};

export function isProblem(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ProblemDetails>;
  return typeof candidate.code === 'string' && typeof candidate.status === 'number';
}

export function describeProblem(
  problem: ProblemDetails,
  retryAfterSeconds: number | null = null,
): UserFacingError {
  const seconds = retryAfterSeconds;
  const message =
    problem.code === ERROR_CODES.RATE_LIMITED && seconds !== null
      ? t('error.rateLimited', { seconds })
      : resolveMessage(problem);

  return {
    message,
    requestId: problem.requestId === '' ? null : problem.requestId,
    fieldErrors: problem.errors ?? [],
    retryAfterSeconds: seconds,
    sessionEnded:
      problem.code === ERROR_CODES.TOKEN_INVALID || problem.code === ERROR_CODES.UNAUTHENTICATED,
  };
}

function resolveMessage(problem: ProblemDetails): string {
  const key = MESSAGE_BY_CODE[problem.code];
  if (key !== undefined) return t(key);
  // Sunucunun kendi metni — `detail` daha açıklayıcı olduğunda o tercih edilir.
  if (typeof problem.detail === 'string' && problem.detail !== '') return problem.detail;
  if (problem.title !== '') return problem.title;
  return t('error.title');
}

/** Ağ hatası — problem belgesi bile alamadığımız durum. */
export function networkError(): UserFacingError {
  return {
    message: t('error.network'),
    requestId: null,
    fieldErrors: [],
    retryAfterSeconds: null,
    sessionEnded: false,
  };
}
