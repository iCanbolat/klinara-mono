import { NextResponse } from 'next/server';
import { accessCookie, refreshCookie } from '@/lib/session/cookies';
import { unavailable } from '@/lib/session/handlers';
import { seal } from '@/lib/session/seal';
import { singleFlight } from '@/lib/session/single-flight';
import { applyClearAll, applyCookie, readAccess, readRefresh } from '@/lib/session/store';
import { callUpstreamJson } from '@/lib/session/upstream';

/**
 * `POST /auth/refresh`'i çağıran TEK kod yolu.
 *
 * Bu tekliğin sebebi `apps/api/src/modules/identity/auth.service.ts`:
 * `markRefreshTokenUsed` koşullu bir update ve YARIŞI KAYBEDEN istek "yeniden
 * kullanım" muamelesi görüp oturum AİLESİNİN TAMAMINI iptal ediyor. Yani iki
 * eş zamanlı yenilemenin bedeli yavaşlık değil, kullanıcının bütün
 * cihazlarından atılması.
 *
 * SERİLEŞTİRMEYİ TARAYICI YAPIYOR. Yenileme token'ı yalnız tarayıcının cookie
 * kavanozunda yaşıyor, dolayısıyla hiçbir sunucu instance'ı tarayıcı vermeden
 * yenileyemez; `lib/api/client.ts`teki `navigator.locks` de tüm sekmeleri tek
 * sıraya diziyor. Bu, "modül kapsamlı bir Map serverless'ta çalışmaz"
 * itirazının cevabı: mutex sunucuya KONMUYOR.
 *
 * Buradaki `singleFlight` yalnız aynı ısınmış instance'a aynı milisaniyede
 * düşen iki isteği birleştiren bir emniyet ağı — garanti değil, ve bu dosyanın
 * doğruluğu ona dayanmıyor.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UpstreamTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

export async function POST(): Promise<Response> {
  const stored = await readRefresh();
  if (stored === null) {
    // Yenilenecek bir şey yok — istemci girişe gitmeli.
    const response = NextResponse.json({ step: 'expired' }, { status: 401 });
    applyClearAll(response);
    return response;
  }

  const outcome = await singleFlight(`refresh:${stored.sid}`, async () =>
    callUpstreamJson<UpstreamTokens>('auth/refresh', {
      method: 'POST',
      json: { refreshToken: stored.rt },
    }),
  );

  if (outcome === null) {
    // AĞ hatası — sunucuya ulaşamadık. Cookie'lere DOKUNMUYORUZ: ulaşamadığımız
    // bir sunucu, oturumun bittiği anlamına gelmez. İstemci tekrar dener.
    return unavailable();
  }

  if (outcome.problem !== null) {
    // Yukarı akış reddetti — token yanmış, süresi dolmuş ya da aile iptal
    // edilmiş. Hepsinin cevabı aynı: oturumu temizle, kullanıcıyı girişe düşür.
    const response = NextResponse.json(outcome.problem, {
      status: outcome.status,
      headers: { 'content-type': 'application/problem+json' },
    });
    applyClearAll(response);
    return response;
  }

  const tokens = outcome.data;
  if (tokens === null) return unavailable();

  // Kiracı ve kullanıcı kimliği yenileme yanıtında GELMİYOR; onları eski
  // erişim cookie'sinden taşıyoruz. Boş bırakılsalardı kabuk, yenilemeden
  // sonra hangi kiracıda olduğunu unuturdu.
  const previous = await readAccess();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const response = NextResponse.json({
    step: 'authenticated' as const,
    expiresIn: tokens.expiresIn,
  });

  applyCookie(
    response,
    accessCookie(
      await seal(
        {
          at: tokens.accessToken,
          exp: nowSeconds + tokens.expiresIn,
          sid: stored.sid,
          tid: previous?.tid ?? '',
          uid: previous?.uid ?? '',
        },
        'at',
      ),
    ),
  );
  // Rotasyon: yeni yenileme token'ı ESKİSİNİ geçersiz kılar. Yazmayı atlarsak
  // bir sonraki yenileme yanmış token'la gider ve oturum ailesi iptal edilir.
  applyCookie(
    response,
    refreshCookie(
      await seal({ rt: tokens.refreshToken, sid: stored.sid, exp: stored.exp }, 'rt'),
    ),
  );

  return response;
}
