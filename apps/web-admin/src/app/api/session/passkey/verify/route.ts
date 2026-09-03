import { type NextRequest } from 'next/server';
import { badRequest, readJsonBody, runAuthFlow } from '@/lib/session/handlers';

/** Passkey ile giriş — doğrulama. Oturum açar, yani cookie yazar. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null || typeof body.response !== 'object' || body.response === null) {
    return badRequest('Passkey yanıtı okunamadı.');
  }
  return runAuthFlow('auth/passkey/verify', {
    response: body.response,
    ...(typeof body.deviceLabel === 'string' ? { deviceLabel: body.deviceLabel } : {}),
  });
}
