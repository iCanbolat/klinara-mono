'use client';

import type { ProblemDetails } from '@klinara/shared';
import { SESSION_SIGNAL_HEADER } from '@/lib/proxy-headers';

/**
 * Tarayıcının API'ye tek giriş noktası.
 *
 * ADRES SABİT: her istek `/api/a` (yetkili proxy) ya da `/api/session` (oturum
 * uçları) üzerinden, AYNI ORIGIN'den gidiyor. Çağıran API'nin adresini hiç
 * bilmiyor ve bilmemeli — bildiği gün birinin oraya doğrudan token'la gitmesi
 * an meselesi olurdu.
 *
 * YENİLEME BURADA SERİLEŞTİRİLİYOR. `navigator.locks` tüm sekmeleri tek sıraya
 * diziyor; bu, dağıtık bir kilit olmadan çalışan gerçek garanti, çünkü yenileme
 * token'ı yalnız tarayıcının cookie kavanozunda yaşıyor ve hiçbir sunucu
 * instance'ı tarayıcı vermeden yenileyemiyor.
 */

const PROXY_BASE = '/api/a';
const SESSION_BASE = '/api/session';
const LOCK_NAME = 'klinara-session-refresh';

export class ApiProblemError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly retryAfterSeconds: number | null,
  ) {
    super(problem.title);
    this.name = 'ApiProblemError';
  }

  get code(): string {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }
}

/** Oturum öldüğünde fırlatılır; `SessionProvider` bunu yakalayıp modal açar. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Oturum sona erdi');
    this.name = 'SessionExpiredError';
  }
}

/** Oturumun bittiğini dinleyenlere haber vermek için — provider abone oluyor. */
type ExpiryListener = () => void;
const expiryListeners = new Set<ExpiryListener>();

export function onSessionExpired(listener: ExpiryListener): () => void {
  expiryListeners.add(listener);
  return () => expiryListeners.delete(listener);
}

function announceExpiry(): void {
  for (const listener of expiryListeners) listener();
}

/**
 * Erişim token'ının bitiş anı (ms).
 *
 * Kilit içinde ikinci kez yenileme yapılmasını engelliyor: sıradaki sekme
 * kilidi aldığında token çoktan tazelenmiş olabilir.
 */
let sessionExpiryHint = 0;

export function noteSessionExpiry(expiresInSeconds: number): void {
  sessionExpiryHint = Date.now() + expiresInSeconds * 1000;
}

export function clearSessionExpiry(): void {
  sessionExpiryHint = 0;
}

/**
 * Yenilemeyi kilit altında yap.
 *
 * `navigator.locks` yoksa (çok eski tarayıcı) sayfa içi bir promise'e
 * düşülüyor; bu durumda sekmeler arası yarış MÜMKÜN hâle geliyor ve en kötü
 * sonucu bir kez zorunlu yeniden giriş. Kabul edilebilir bir bozulma.
 */
let fallbackRefresh: Promise<boolean> | null = null;

export async function refreshSession(force = false): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    // Sırada beklerken başka bir sekme yenilemiş olabilir.
    if (!force && Date.now() < sessionExpiryHint - 5_000) return true;

    const response = await fetch(`${SESSION_BASE}/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      clearSessionExpiry();
      announceExpiry();
      return false;
    }
    const body = (await response.json()) as { expiresIn?: number };
    if (typeof body.expiresIn === 'number') noteSessionExpiry(body.expiresIn);
    return true;
  };

  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(LOCK_NAME, run);
  }
  if (fallbackRefresh !== null) return fallbackRefresh;
  fallbackRefresh = run().finally(() => {
    fallbackRefresh = null;
  });
  return fallbackRefresh;
}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  idempotencyKey?: string;
  ifMatch?: string;
  branchId?: string;
  /** İç kullanım: tekrar denemenin ikinci kez yapılmasını engeller. */
  retried?: boolean;
}

/**
 * Ham istek: başlıklar, 401 yenilemesi ve tekrar denemesi.
 *
 * `request`ten AYRILDI çünkü CSV indirme aynı oturum davranışını istiyor ama
 * gövdeyi JSON olarak ayrıştıramaz. Ayırmadan önceki tek alternatif, indirme
 * için ikinci bir fetch yolu yazmaktı — ve o yol 401'i, yenilemeyi ve oturum
 * bitişi duyurusunu kendi başına yeniden uygulamak zorunda kalırdı.
 */
async function send(
  method: string,
  path: string,
  options: RequestOptions & { accept?: string } = {},
): Promise<Response> {
  const headers = new Headers({ accept: options.accept ?? 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.idempotencyKey !== undefined) headers.set('idempotency-key', options.idempotencyKey);
  if (options.ifMatch !== undefined) headers.set('if-match', options.ifMatch);
  if (options.branchId !== undefined) headers.set('x-branch-id', options.branchId);

  const response = await fetch(`${PROXY_BASE}/${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (response.status === 401) {
    const signal = response.headers.get(SESSION_SIGNAL_HEADER);
    if (signal === 'refresh' && options.retried !== true) {
      // Kilidi al, yenile, isteği BİR KEZ tekrarla. İkinci bir tekrar yok:
      // yenileme başarılı olup istek yine 401 dönüyorsa sorun token değil.
      const refreshed = await refreshSession(true);
      if (refreshed) return send(method, path, { ...options, retried: true });
    }
    clearSessionExpiry();
    announceExpiry();
    throw new SessionExpiredError();
  }

  return response;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(method, path, options);

  if (response.status === 204) return undefined as T;

  const payload: unknown = await safeJson(response);
  if (!response.ok) {
    throw new ApiProblemError(toProblem(payload, response.status), retryAfter(response));
  }
  return payload as T;
}

/**
 * Dosya indirir — CSV dışa aktarım.
 *
 * `<a href download>` KULLANILMIYOR. İki sebep: uç `POST` (gövde bir filtre
 * taşıyor, sorgu dizgesine sığmaz) ve oturum bitmişse bir anchor sessizce
 * giriş sayfasının HTML'ini `.csv` diye indirirdi. Buradan geçince 401,
 * yenileme ve problem belgesi olağan yolla işleniyor.
 *
 * Dosya adı sunucunun `Content-Disposition` başlığından okunuyor; istemci
 * ikinci bir ad üretmiyor ki indirilen dosyayla sunucudaki rapor aynı adı
 * taşısın.
 */
export async function downloadFile(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<void> {
  const response = await send('POST', path, { ...options, body, accept: 'text/csv' });

  if (!response.ok) {
    const payload: unknown = await safeJson(response);
    throw new ApiProblemError(toProblem(payload, response.status), retryAfter(response));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filenameFrom(response.headers.get('content-disposition'));
    // Belgeye EKLENİYOR: Firefox eklenmemiş bir anchor'ın tıklamasını yok
    // sayıyor.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Sekme kapanana kadar bellekte kalmasın; tıklama zaten senkron başladı.
    URL.revokeObjectURL(url);
  }
}

/** `attachment; filename="rapor.csv"` → `rapor.csv`. */
function filenameFrom(header: string | null): string {
  const match = header === null ? null : /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? 'rapor.csv';
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isNaN(seconds) ? null : seconds;
}

/**
 * Uymayan yanıt için de bir problem belgesi ÜRET.
 *
 * Böylece çağıran hiçbir zaman "bazen problem belgesi, bazen bilinmeyen" diye
 * dallanmıyor — `apps/web-booking/src/lib/booking-fetch.ts` ile aynı karar.
 */
function toProblem(payload: unknown, status: number): ProblemDetails {
  if (typeof payload === 'object' && payload !== null) {
    const candidate = payload as Partial<ProblemDetails>;
    if (typeof candidate.code === 'string' && typeof candidate.status === 'number') {
      return candidate as ProblemDetails;
    }
  }
  return {
    type: 'https://errors.klinara.app/unknown',
    title: 'Beklenmeyen bir hata oluştu',
    status,
    code: 'UNKNOWN',
    instance: '',
    requestId: '',
  };
}

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>('POST', path, { ...options, ...(body === undefined ? {} : { body }) }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>('PUT', path, { ...options, ...(body === undefined ? {} : { body }) }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>('PATCH', path, { ...options, ...(body === undefined ? {} : { body }) }),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, options),
};

/** Oturum uçları — proxy'den DEĞİL, kendi handler'larından geçiyor. */
export async function sessionCall<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${SESSION_BASE}/${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await safeJson(response);
  if (!response.ok) {
    throw new ApiProblemError(toProblem(payload, response.status), retryAfter(response));
  }
  return payload as T;
}
