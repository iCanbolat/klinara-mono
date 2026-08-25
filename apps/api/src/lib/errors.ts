import { ERROR_CODES, type ErrorCode } from '@klinara/shared';

export interface ProblemFields {
  /** RFC 9457 `detail` — insana yönelik açıklama. */
  detail?: string;
  /** Yanıt gövdesine eklenecek ek alanlar (ör. `conflicts`). */
  extra?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Bilinen (beklenen) uygulama hatası. Merkezi error handler bunları
 * RFC 9457 `application/problem+json` yanıtına çevirir.
 *
 * Beklenmeyen hatalar bu sınıftan TÜREMEZ — onlar 500 + INTERNAL_ERROR olur ve
 * istemciye hiçbir iç ayrıntı sızdırmaz.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  readonly extra: Record<string, unknown> | undefined;

  constructor(statusCode: number, code: ErrorCode, title: string, fields: ProblemFields = {}) {
    super(title, fields.cause !== undefined ? { cause: fields.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.detail = fields.detail;
    this.extra = fields.extra;
  }

  static notFound(title = 'Kayıt bulunamadı', fields?: ProblemFields) {
    return new AppError(404, ERROR_CODES.NOT_FOUND, title, fields);
  }

  static forbidden(title = 'Bu işlem için yetkiniz yok', fields?: ProblemFields) {
    return new AppError(403, ERROR_CODES.FORBIDDEN, title, fields);
  }

  static unauthenticated(title = 'Kimlik doğrulaması gerekli', fields?: ProblemFields) {
    return new AppError(401, ERROR_CODES.UNAUTHENTICATED, title, fields);
  }

  static conflict(code: ErrorCode, title: string, fields?: ProblemFields) {
    return new AppError(409, code, title, fields);
  }

  static unavailable(title = 'Servis şu anda kullanılamıyor', fields?: ProblemFields) {
    return new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, title, fields);
  }
}
