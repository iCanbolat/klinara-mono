import { NextResponse } from 'next/server';
import type { Me } from '@klinara/shared';
import { problemResponse, unavailable } from '@/lib/session/handlers';
import { decideOn401, SESSION_SIGNAL_HEADER } from '@/lib/proxy-headers';
import { applyClearAll, readAccess } from '@/lib/session/store';
import { callUpstreamJson } from '@/lib/session/upstream';

/**
 * Oturum açılışında kabuğun ilk çağrısı: kullanıcı, kiracı, roller, izinler.
 *
 * Genel proxy'de de erişilebilir (`me` beyaz listede) ama `SessionProvider`
 * burayı çağırıyor: 401'i oturum sinyaline çeviren mantık tek yerde kalsın.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const access = await readAccess();
  if (access === null) {
    return NextResponse.json({ error: 'unauthenticated' }, {
      status: 401,
      headers: { [SESSION_SIGNAL_HEADER]: 'expired' },
    });
  }

  const result = await callUpstreamJson<Me>('me', { method: 'GET', bearer: access.at });
  if (result === null) return unavailable();

  if (result.status === 401) {
    const signal = decideOn401(result.problem);
    const response = NextResponse.json(result.problem, {
      status: 401,
      headers: { 'content-type': 'application/problem+json', [SESSION_SIGNAL_HEADER]: signal },
    });
    if (signal === 'expired') applyClearAll(response);
    return response;
  }
  if (result.problem !== null) return problemResponse(result.problem, result.status);
  return NextResponse.json(result.data);
}
