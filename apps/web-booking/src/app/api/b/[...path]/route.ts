import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/config/env';
import { isAllowedProxyPath } from '@/lib/proxy-allowlist';

/**
 * Public API'ye aynı origin'den geçiş katmanı.
 *
 * NEDEN PROXY, neden tarayıcı doğrudan API'ye gitmiyor: her kiracının özel alan
 * adı ayrı bir `Origin`'dir ve `CORS_ORIGINS` statik bir listedir — onları
 * hiçbir zaman sayamaz. Alternatifi her preflight'ta `booking_site_domains`'e
 * vuran dinamik bir origin callback'iydi, yani sıcak yola yeni bir sorgu.
 *
 * ⚠️ Hız sınırı bu dosyaya EMANET. API'nin public throttler'ı `request.ip`
 * okuyor ve `trust proxy` açık; `x-forwarded-for` iletilmezse tüm ziyaretçiler
 * tek bir IP'ye çöker ve OTP tavanları anlamsızlaşır. Bunun testi ağ
 * sekmesinde değil, API logundaki IP'de.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Yukarı akışa iletilen istek başlıkları — beyaz liste. */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'idempotency-key',
  'if-none-match',
  'user-agent',
] as const;

/** İstemciye geri verilen yanıt başlıkları — beyaz liste. */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'etag',
  'retry-after',
  'content-disposition',
  'content-language',
] as const;

async function handle(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join('/');

  if (!isAllowedProxyPath(joined, request.method)) {
    // Ayrıntı verilmiyor: hangi yolun var olduğu bilgisi, beyaz listeyi
    // haritalamak isteyen birine yol tarifidir.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const upstream = new URL(`${serverEnv.apiInternalUrl}/public/${joined}`);
  upstream.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('x-forwarded-for', clientIp(request));

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers,
      ...(request.method === 'GET' || request.method === 'DELETE'
        ? {}
        : { body: await request.text() }),
      // Yukarı akış cache'i BURADA kapalı: bu yoldan yalnız ziyaretçiye özel
      // ve mutasyon yapan çağrılar geçiyor. Cache'lenebilir okumalar RSC
      // tarafında, tag'li fetch ile yapılıyor.
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return NextResponse.json(
      { code: 'SERVICE_UNAVAILABLE', title: 'Servise ulaşılamadı', status: 503 },
      { status: 503, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const outHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) outHeaders.set(name, value);
  }
  // 304'ün gövdesi olamaz; `Response` bunu zorluyor.
  if (response.status === 304 || response.status === 204) {
    return new NextResponse(null, { status: response.status, headers: outHeaders });
  }
  return new NextResponse(response.body, { status: response.status, headers: outHeaders });
}

/**
 * Gerçek istemci IP'si.
 *
 * Next kendi `x-forwarded-for`'unu üretmiyor; kenar proxy'sinin (yerelde
 * tarayıcının doğrudan bağlantısı) bıraktığı değer okunuyor. İlk parça
 * istemcinin kendisi, sonrakiler ara proxy'ler.
 */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first !== '') return first;
  return request.headers.get('x-real-ip') ?? '127.0.0.1';
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
