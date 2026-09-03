import 'server-only';
import { serverEnv } from '@/config/env';
import type { ProblemDetails } from '@klinara/shared';

/**
 * API'ye giden TEK çağrı noktası.
 *
 * ⚠️ Bu modül YALNIZ Route Handler'lardan (`src/app/api/**`) import edilebilir
 * ve bu kural `eslint.config.js` ile zorlanıyor.
 *
 * Sebep Next 15'in bir kısıtı: `cookies().set()` bir RSC içinde çağrıldığında
 * fırlıyor. Yetkili bir çağrı her an "erişim token'ı süresi doldu, yenile ve
 * cookie'yi güncelle" durumuna düşebilir; bu iş RSC'de yapılamaz. Kuralı
 * yoruma bırakmak, aylar sonra birinin bir layout'a `await fetchSite()`
 * yazmasıyla sessizce kırılırdı — hata mesajı da "cookies can only be modified
 * in a Server Action or Route Handler" gibi, sebebi anlatmayan bir metin olurdu.
 */

export interface UpstreamResult {
  status: number;
  headers: Headers;
  /** Ham gövde — proxy bunu olduğu gibi geçiriyor. */
  body: ArrayBuffer | null;
}

export interface UpstreamOptions {
  method: string;
  /** Yukarı akışa gidecek Bearer token; yoksa başlık hiç eklenmiyor. */
  bearer?: string | undefined;
  headers?: Headers | undefined;
  body?: BodyInit | null | undefined;
  search?: string | undefined;
  signal?: AbortSignal | undefined;
}

/** Yukarı akışa ulaşılamadığında dönen RFC 9457 gövdesi. */
export const SERVICE_UNAVAILABLE: ProblemDetails = {
  type: 'https://errors.klinara.app/service-unavailable',
  title: 'Servise ulaşılamadı',
  status: 503,
  code: 'SERVICE_UNAVAILABLE',
  instance: '',
  requestId: '',
};

/**
 * API'ye istek at.
 *
 * `cache: 'no-store'` sabit: bu yoldan yalnız kullanıcıya ÖZEL ve mutasyon
 * yapan çağrılar geçiyor. Bir yönetim yanıtının Next'in veri cache'ine
 * düşmesi, bir kiracının taslağını başka bir kiracıya servis etmek demekti.
 */
export async function callUpstream(
  path: string,
  options: UpstreamOptions,
): Promise<UpstreamResult | null> {
  const url = new URL(`${serverEnv.apiInternalUrl}/${path}`);
  if (options.search !== undefined && options.search !== '') url.search = options.search;

  const headers = new Headers(options.headers ?? {});
  if (options.bearer !== undefined && options.bearer !== '') {
    headers.set('authorization', `Bearer ${options.bearer}`);
  }

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      ...(options.body === undefined || options.body === null ? {} : { body: options.body }),
      cache: 'no-store',
      redirect: 'manual',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const body =
      response.status === 204 || response.status === 304 ? null : await response.arrayBuffer();
    return { status: response.status, headers: response.headers, body };
  } catch {
    // Ağ hatası ile 5xx'i çağırana AYIRT ETTİRİYORUZ (`null` vs sonuç): proxy
    // ikisini de 503'e çevirir ama oturum handler'ları ağ hatasında cookie'ye
    // DOKUNMAMALI — ulaşamadığımız bir sunucu, oturumun bittiği anlamına gelmez.
    return null;
  }
}

/** JSON gövdeli yardımcı — oturum handler'ları bunu kullanıyor. */
export async function callUpstreamJson<T>(
  path: string,
  options: Omit<UpstreamOptions, 'body'> & { json?: unknown },
): Promise<{ status: number; data: T | null; problem: ProblemDetails | null } | null> {
  const headers = new Headers(options.headers ?? {});
  if (options.json !== undefined) headers.set('content-type', 'application/json');

  const result = await callUpstream(path, {
    ...options,
    headers,
    ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
  });
  if (result === null) return null;

  const text = result.body === null ? '' : new TextDecoder().decode(result.body);
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (result.status >= 400) {
    return { status: result.status, data: null, problem: asProblem(parsed, result.status) };
  }
  return { status: result.status, data: parsed as T, problem: null };
}

/**
 * Yanıtı RFC 9457 belgesine çevirir; uymayan yanıt için bir tane ÜRETİR.
 *
 * Böylece çağıran hiçbir zaman "bazen problem belgesi, bazen bilinmeyen" diye
 * dallanmak zorunda kalmıyor — `apps/web-booking/src/lib/booking-fetch.ts`
 * ile aynı yaklaşım.
 */
function asProblem(parsed: unknown, status: number): ProblemDetails {
  if (typeof parsed === 'object' && parsed !== null) {
    const candidate = parsed as Partial<ProblemDetails>;
    if (typeof candidate.code === 'string' && typeof candidate.status === 'number') {
      return candidate as ProblemDetails;
    }
  }
  return {
    type: 'https://errors.klinara.app/unknown',
    title: 'Beklenmeyen hata',
    status,
    code: 'UNKNOWN',
    instance: '',
    requestId: '',
  };
}
