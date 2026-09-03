import { NextResponse, type NextRequest } from 'next/server';
import { problemResponse, readJsonBody, unavailable } from '@/lib/session/handlers';
import { callUpstreamJson } from '@/lib/session/upstream';

/**
 * Passkey ile GİRİŞ — seçenek üretimi (tekil `passkey`, çoğul `passkeys` değil).
 *
 * Dönen challenge bir kimlik bilgisi değil, o yüzden gövdeyle tarayıcıya
 * inmesinde sakınca yok; WebAuthn zaten origin'e bağlı çalışıyor.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await readJsonBody(request)) ?? {};
  const result = await callUpstreamJson<Record<string, unknown>>('auth/passkey/options', {
    method: 'POST',
    json: typeof body.email === 'string' ? { email: body.email } : {},
  });
  if (result === null) return unavailable();
  if (result.problem !== null) return problemResponse(result.problem, result.status);
  return NextResponse.json(result.data);
}
