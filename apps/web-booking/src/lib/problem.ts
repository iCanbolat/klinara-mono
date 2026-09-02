import type { ProblemDetails } from '@klinara/shared';

export type { ProblemDetails };

export function isProblem(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ProblemDetails>;
  return typeof candidate.code === 'string' && typeof candidate.status === 'number';
}

/**
 * API'nin RFC 9457 gövdesini taşıyan hata.
 *
 * `Retry-After` gövdede değil BAŞLIKTA geliyor; hız sınırı ve OTP kilidi
 * ekranları saniyeyi oradan okuduğu için başlık burada taşınıyor.
 */
export class ApiProblemError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiProblemError';
  }

  get code(): string {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }
}
