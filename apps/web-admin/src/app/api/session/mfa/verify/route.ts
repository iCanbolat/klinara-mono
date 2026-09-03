import { type NextRequest } from 'next/server';
import { badRequest, readJsonBody, runAuthFlow } from '@/lib/session/handlers';
import { readChallenge } from '@/lib/session/store';

/** İkinci faktör doğrulaması — challenge token cookie'den. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) return badRequest('Gövde okunamadı.');
  if (typeof body.code !== 'string') return badRequest('Doğrulama kodu zorunlu.');

  const challenge = await readChallenge();
  if (challenge === null || challenge.kind !== 'mfa') {
    return badRequest('Doğrulama oturumu zaman aşımına uğradı. Lütfen yeniden giriş yapın.');
  }

  return runAuthFlow('auth/2fa/verify', {
    challengeToken: challenge.ct,
    code: body.code,
    ...(typeof body.deviceLabel === 'string' ? { deviceLabel: body.deviceLabel } : {}),
  });
}
