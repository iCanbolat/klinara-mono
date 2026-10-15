import { NextResponse, type NextRequest } from 'next/server';
import { isProduction } from '@/config/env';
import {
  isAllowedPlatformPath,
  PLATFORM_COOKIE,
  platformCookieOptions,
  type PlatformSessionPayload,
} from '@/lib/platform-session';
import { unseal } from '@/lib/session/seal';
import { callUpstream, SERVICE_UNAVAILABLE } from '@/lib/session/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Platform proxy'si — klinik proxy'sinden (`/api/a/*`) AYRI.
 *
 * Klinik proxy'sinin beyaz listesi `platform/*`i bilerek dışarıda tutuyor;
 * burası yalnız kiracı yönetimi uçlarını, yalnız platform cookie'siyle geçirir.
 * Token ve gerekçe cookie'den gelir; istemcinin gönderdiği `Authorization`
 * veya `X-Support-Reason` hiç okunmaz.
 */
async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const joined = path.join('/');
  if (!isAllowedPlatformPath(joined, request.method)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const sealed = request.cookies.get(PLATFORM_COOKIE)?.value;
  const session = sealed === undefined ? null : await unseal<PlatformSessionPayload>(sealed, 'pt');
  if (session === null || session.exp * 1000 <= Date.now()) {
    return NextResponse.json(
      { code: 'UNAUTHENTICATED', title: 'Platform oturumu yok' },
      { status: 401 },
    );
  }

  const headers = new Headers({ 'x-support-reason': session.reason });
  const contentType = request.headers.get('content-type');
  if (contentType !== null) headers.set('content-type', contentType);

  const result = await callUpstream(`platform/${joined}`, {
    method: request.method,
    bearer: session.token,
    headers,
    search: request.nextUrl.search,
    ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }),
  });
  if (result === null) {
    return NextResponse.json(SERVICE_UNAVAILABLE, { status: 503 });
  }

  const response = new NextResponse(result.status === 204 ? null : result.body, {
    status: result.status,
    headers: { 'content-type': result.headers.get('content-type') ?? 'application/json' },
  });
  // Token süresi dolduysa (`PLATFORM_ADMIN_TOKEN_NOT_AFTER`) oturum da biter.
  if (result.status === 401) {
    response.cookies.set(PLATFORM_COOKIE, '', {
      ...platformCookieOptions(isProduction),
      maxAge: 0,
    });
  }
  return response;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
