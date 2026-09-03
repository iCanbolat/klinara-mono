import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedProxyPath } from '@/lib/proxy-allowlist';
import {
  decideOn401,
  FORWARD_REQUEST_HEADERS,
  FORWARD_RESPONSE_HEADERS,
  sanitizeBranchId,
  SESSION_SIGNAL_HEADER,
} from '@/lib/proxy-headers';
import { callUpstream, SERVICE_UNAVAILABLE } from '@/lib/session/upstream';
import { applyClearAll, readAccess } from '@/lib/session/store';

/**
 * Yetkili API'ye aynı origin'den geçiş katmanı.
 *
 * NEDEN PROXY: tarayıcının API token'ı görmemesi için. Token'lar mühürlü
 * httpOnly cookie'de duruyor ve buraya, yalnız burada, `Authorization`
 * başlığına dönüşüyor. Bir XSS bulan saldırgan istek ATABİLİR ama token'ı
 * ÇALAMAZ ve başka bir origin'e taşıyamaz — fark, oturumun kullanıcı sekmesini
 * kapatınca bitmesiyle saldırganın 30 gün cebinde taşıması arasındaki fark.
 *
 * ⚠️ BU DOSYA BİR TÜNEL OLABİLİRDİ. Yakalayıcı bir rota, isteğe kullanıcının
 * oturum token'ını ekleyip `/api/v1`in köküne gönderiyor. Tek savunma
 * `proxy-allowlist.ts` — ve o dosya kendi 40 vakalık testine sahip.
 *
 * ⚠️ BU PROXY ASLA YENİLEME YAPMAZ. Yukarı akış `TOKEN_EXPIRED` dediğinde 401'i
 * bir sinyal başlığıyla geçiriyor ve yenilemeyi İSTEMCİYE bırakıyor. Sebep
 * `auth.service.ts`in yeniden kullanım tespiti: sunucu-kaynaklı bir yenileme,
 * istemci-kaynaklı bir yenilemeyle yarışabilir ve yarışı kaybeden istek oturum
 * AİLESİNİN TAMAMINI iptal ettirir. Serileştirme tarayıcıdaki `navigator.locks`
 * ile yapılıyor (`lib/api/client.ts`) ve bunun çalışması için yenilemenin tek
 * bir yerden çağrılması şart.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const joined = path.join('/');

  if (!isAllowedProxyPath(joined, request.method)) {
    // Ayrıntı verilmiyor: hangi yolun var olduğu bilgisi, beyaz listeyi
    // haritalamak isteyen birine yol tarifidir.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const access = await readAccess();
  if (access === null) {
    return problem(401, 'UNAUTHENTICATED', 'Oturum bulunamadı', 'expired');
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Şube kapsamı: biçim burada, ÜYELİK yukarı akışta denetleniyor.
  const branchId = sanitizeBranchId(request.headers.get('x-branch-id'));
  if (branchId !== null) headers.set('x-branch-id', branchId);

  const result = await callUpstream(joined, {
    method: request.method,
    bearer: access.at,
    headers,
    search: request.nextUrl.search,
    ...(request.method === 'GET' || request.method === 'DELETE'
      ? {}
      : { body: await request.arrayBuffer() }),
  });

  if (result === null) {
    return NextResponse.json(SERVICE_UNAVAILABLE, {
      status: 503,
      headers: { 'content-type': 'application/problem+json' },
    });
  }

  const outHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = result.headers.get(name);
    if (value !== null) outHeaders.set(name, value);
  }

  if (result.status === 401) {
    const signal = decideOn401(parseBody(result.body));
    outHeaders.set(SESSION_SIGNAL_HEADER, signal);
    const response = new NextResponse(result.body, { status: 401, headers: outHeaders });
    // Oturum gerçekten öldüyse cookie'leri BURADA siliyoruz: istemcinin
    // temizlemesini beklemek, kullanıcının sekmesinde yanmış bir token'ın
    // dolaşmaya devam etmesi demekti.
    if (signal === 'expired') applyClearAll(response);
    return response;
  }

  // 304 ve 204'ün gövdesi olamaz; `Response` bunu zorluyor.
  if (result.status === 304 || result.status === 204) {
    return new NextResponse(null, { status: result.status, headers: outHeaders });
  }
  return new NextResponse(result.body, { status: result.status, headers: outHeaders });
}

function parseBody(body: ArrayBuffer | null): unknown {
  if (body === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

function problem(
  status: number,
  code: string,
  title: string,
  signal: string,
): NextResponse {
  return NextResponse.json(
    { type: `https://errors.klinara.app/${code.toLowerCase()}`, title, status, code, instance: '', requestId: '' },
    {
      status,
      headers: { 'content-type': 'application/problem+json', [SESSION_SIGNAL_HEADER]: signal },
    },
  );
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
