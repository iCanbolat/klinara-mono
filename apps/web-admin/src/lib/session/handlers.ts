import 'server-only';
import { NextResponse } from 'next/server';
import type { ProblemDetails } from '@klinara/shared';
import { planFromLogin, type SessionPlan, type UpstreamLoginResponse } from './login-step';
import { applyPlan } from './store';
import { callUpstreamJson, SERVICE_UNAVAILABLE } from './upstream';

/**
 * Oturum handler'larının ortak iskeleti.
 *
 * Her handler'ın yaptığı iş aynı: gövdeyi al, yukarı akışa geçir, yanıtı
 * `SessionStep`e çevir, cookie'leri yaz. Tekrarı buraya toplamak yalnız
 * kısalık meselesi değil — "token'ı gövdeye koymayı unutma" hatası tek bir
 * yerde yapılabilir hâle geliyor.
 */

/** Yukarı akış problemini olduğu gibi geçir. */
export function problemResponse(problem: ProblemDetails, status: number): NextResponse {
  return NextResponse.json(problem, {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

export function unavailable(): NextResponse {
  return NextResponse.json(SERVICE_UNAVAILABLE, {
    status: 503,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** Gövdeyi güvenle oku; bozuk JSON bir 400'dür, bir istisna değil. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function badRequest(detail: string): NextResponse {
  return NextResponse.json(
    {
      type: 'https://errors.klinara.app/validation-failed',
      title: 'Geçersiz istek',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail,
      instance: '',
      requestId: '',
    },
    { status: 400, headers: { 'content-type': 'application/problem+json' } },
  );
}

/**
 * Giriş benzeri bir ucu çağır ve sonucu cookie + `SessionStep` olarak yaz.
 *
 * `plan` parametresi opsiyonel çünkü davet kabulünün ikinci yanıt şekli
 * (`membership_added`) farklı bir eşleyici istiyor.
 */
export async function runAuthFlow(
  path: string,
  json: unknown,
  options: {
    bearer?: string | undefined;
    plan?: (response: UpstreamLoginResponse, nowMs: number) => SessionPlan;
  } = {},
): Promise<NextResponse> {
  const result = await callUpstreamJson<UpstreamLoginResponse>(path, {
    method: 'POST',
    json,
    ...(options.bearer === undefined ? {} : { bearer: options.bearer }),
  });
  if (result === null) return unavailable();
  if (result.problem !== null) return problemResponse(result.problem, result.status);
  if (result.data === null) return unavailable();

  let plan: SessionPlan;
  try {
    plan = (options.plan ?? planFromLogin)(result.data, Date.now());
  } catch {
    // Yukarı akış kendi `status`'uyla tutarsız bir yanıt döndü. Yarım kurulmuş
    // bir oturum bırakmaktansa 502 vermek doğru.
    return NextResponse.json(
      {
        type: 'https://errors.klinara.app/upstream-invalid',
        title: 'Sunucudan beklenmeyen yanıt',
        status: 502,
        code: 'UPSTREAM_INVALID',
        instance: '',
        requestId: '',
      },
      { status: 502, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const response = NextResponse.json(plan.step);
  await applyPlan(response, plan);
  return response;
}
