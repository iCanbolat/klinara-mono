import { NextResponse } from 'next/server';
import { applyClearAll, readAccess } from '@/lib/session/store';
import { callUpstream } from '@/lib/session/upstream';

/**
 * Çıkış.
 *
 * Yukarı akış çağrısı BAŞARISIZ OLSA BİLE cookie'ler siliniyor: kullanıcı
 * "çıkış yap" dediğinde bu cihazda oturumun bitmesi, sunucu tarafındaki
 * iptalin başarısına bağlı olmamalı. Sunucu tarafı zaten en geç 30 günde
 * kendiliğinden düşüyor ve kullanıcı gerekirse `logout-all` ile her yerden
 * çıkabiliyor.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const access = await readAccess();
  if (access !== null) {
    await callUpstream('auth/logout', { method: 'POST', bearer: access.at });
  }
  const response = new NextResponse(null, { status: 204 });
  applyClearAll(response);
  return response;
}
