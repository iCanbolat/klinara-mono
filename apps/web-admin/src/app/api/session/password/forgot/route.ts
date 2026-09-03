import { NextResponse, type NextRequest } from 'next/server';
import { badRequest, problemResponse, readJsonBody, unavailable } from '@/lib/session/handlers';
import { callUpstreamJson } from '@/lib/session/upstream';

/**
 * Parola sıfırlama talebi.
 *
 * Yukarı akış her durumda 202 dönüyor (hesabın var olup olmadığını
 * sızdırmamak için) ve arayüz bu duruşu bozmamalı: "böyle bir e-posta yok"
 * demek, kullanıcı numaralandırma açığıdır.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null || typeof body.email !== 'string') return badRequest('E-posta zorunlu.');

  const result = await callUpstreamJson<{ status: string }>('auth/password/forgot', {
    method: 'POST',
    json: { email: body.email },
  });
  if (result === null) return unavailable();
  if (result.problem !== null) return problemResponse(result.problem, result.status);
  // Yukarı akış yerelde sıfırlama token'ını da dönüyor; onu İLETMİYORUZ.
  return NextResponse.json({ status: 'accepted' }, { status: 202 });
}
