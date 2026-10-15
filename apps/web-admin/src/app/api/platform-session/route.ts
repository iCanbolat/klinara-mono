import { NextResponse, type NextRequest } from 'next/server';
import { isProduction } from '@/config/env';
import {
  MIN_REASON_LENGTH,
  PLATFORM_COOKIE,
  PLATFORM_SESSION_SECONDS,
  platformCookieOptions,
  type PlatformSessionPayload,
} from '@/lib/platform-session';
import { seal } from '@/lib/session/seal';
import { callUpstream } from '@/lib/session/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Platform girişi: token + gerekçe → API'ye `GET platform/tenants` ile
 * doğrulat → mühürlü cookie.
 *
 * Doğrulama gerçek bir çağrı: yanlış ya da süresi dolmuş token cookie'ye hiç
 * yazılmaz. Bu çağrı da `platform_access_log`a "giriş" gerekçesiyle düşer.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    reason?: unknown;
  } | null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (token === '' || reason.length < MIN_REASON_LENGTH) {
    return NextResponse.json(
      {
        code: 'VALIDATION_FAILED',
        title: `Token ve en az ${MIN_REASON_LENGTH} karakterlik gerekçe gerekli`,
      },
      { status: 400 },
    );
  }

  const check = await callUpstream('platform/tenants', {
    method: 'GET',
    bearer: token,
    headers: new Headers({ 'x-support-reason': reason }),
  });
  if (check === null) {
    return NextResponse.json(
      { code: 'SERVICE_UNAVAILABLE', title: 'Servise ulaşılamadı' },
      { status: 503 },
    );
  }
  if (check.status !== 200) {
    // Ayrıntı vermiyoruz: yanlış token ile süresi dolmuş token aynı cevabı alır.
    return NextResponse.json(
      { code: 'UNAUTHENTICATED', title: 'Platform anahtarı geçersiz' },
      { status: 401 },
    );
  }

  const payload: PlatformSessionPayload = {
    token,
    reason,
    exp: Math.floor(Date.now() / 1000) + PLATFORM_SESSION_SECONDS,
  };
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    PLATFORM_COOKIE,
    await seal(payload, 'pt'),
    platformCookieOptions(isProduction),
  );
  return response;
}

export function DELETE(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PLATFORM_COOKIE, '', { ...platformCookieOptions(isProduction), maxAge: 0 });
  return response;
}
