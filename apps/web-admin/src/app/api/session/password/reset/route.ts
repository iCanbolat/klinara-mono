import { NextResponse, type NextRequest } from 'next/server';
import { badRequest, problemResponse, readJsonBody, unavailable } from '@/lib/session/handlers';
import { applyClearAll } from '@/lib/session/store';
import { callUpstreamJson } from '@/lib/session/upstream';

/**
 * Parola sıfırlama.
 *
 * Yukarı akış TÜM oturumları düşürüyor; bu cihazdaki cookie'leri de silmek
 * zorundayız, yoksa kullanıcı elinde geçersiz bir oturumla kalır ve ilk
 * isteğinde anlamsız bir hata görür.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null || typeof body.token !== 'string' || typeof body.newPassword !== 'string') {
    return badRequest('Token ve yeni parola zorunlu.');
  }

  const result = await callUpstreamJson<null>('auth/password/reset', {
    method: 'POST',
    json: { token: body.token, newPassword: body.newPassword },
  });
  if (result === null) return unavailable();
  if (result.problem !== null) return problemResponse(result.problem, result.status);

  const response = new NextResponse(null, { status: 204 });
  applyClearAll(response);
  return response;
}
