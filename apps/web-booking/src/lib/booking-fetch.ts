import type { ProblemDetails } from '@klinara/shared';
import { ApiProblemError, isProblem } from '@/lib/problem';

/**
 * İstemci tarafı API çağrılarının TEK kapısı.
 *
 * Hepsi `/api/b/...` üzerinden, yani AYNI ORIGIN'den gidiyor (K1). Tarayıcının
 * doğrudan API'ye gitmemesinin sebebi CORS değil ÇOK KİRACILIK: her kiracının
 * özel alan adı ayrı bir `Origin` ve statik bir liste onları sayamaz.
 *
 * Tarayıcı-doğrudan moda geçiş gerekirse değişecek tek yer burasıdır — çağrı
 * yerlerinin hiçbiri API'nin adresini bilmiyor.
 */

const BASE = '/api/b';

export interface FetchOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
}

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  options: FetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey !== undefined) {
    headers['idempotency-key'] = options.idempotencyKey;
  }

  const response = await fetch(`${BASE}/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // Public yüzey token bazlı; çerez göndermek yalnız CSRF yüzeyi üretirdi.
    credentials: 'omit',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text === '' ? null : safeJson(text);

  if (!response.ok) {
    throw new ApiProblemError(toProblem(parsed, response.status), retryAfter(response));
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Yanıt RFC 9457 değilse (proxy 503'ü, ters proxy hatası, HTML hata sayfası)
 * yine de bir problem dokümanı üretiliyor: çağrı yerlerinin "bazen problem,
 * bazen bilinmeyen" ayrımı yapması gerekmesin.
 */
function toProblem(parsed: unknown, status: number): ProblemDetails {
  if (isProblem(parsed)) return parsed;
  return {
    type: 'about:blank',
    title: 'Beklenmeyen hata',
    status,
    code: status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN',
    instance: '',
    requestId: '',
  };
}

/** Hız sınırı ve OTP kilidi ekranları saniyeyi bu başlıktan okuyor. */
function retryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export const bookingApi = {
  get: <T>(path: string, options?: FetchOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: FetchOptions) =>
    request<T>('POST', path, body, options),
  delete: <T>(path: string, options?: FetchOptions) =>
    request<T>('DELETE', path, undefined, options),
};
