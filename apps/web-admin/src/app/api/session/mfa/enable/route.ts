import { NextResponse, type NextRequest } from 'next/server';
import { badRequest, problemResponse, readJsonBody, unavailable } from '@/lib/session/handlers';
import { callUpstreamJson } from '@/lib/session/upstream';
import { mfaBearer } from '../setup/route';

/**
 * 2FA'yı etkinleştir ve yedek kodları döndür.
 *
 * Yedek kodlar YALNIZ BİR KEZ dönüyor; arayüz onları göstermeden ekranı
 * değiştirmemeli.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null || typeof body.code !== 'string') return badRequest('Doğrulama kodu zorunlu.');

  const bearer = await mfaBearer();
  if (bearer === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await callUpstreamJson<{ backupCodes: string[] }>('auth/2fa/enable', {
    method: 'POST',
    bearer,
    json: { code: body.code },
  });
  if (result === null) return unavailable();
  if (result.problem !== null) return problemResponse(result.problem, result.status);
  return NextResponse.json(result.data);
}
