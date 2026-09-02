import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/config/env';
import { evaluateRevalidate } from '@/lib/revalidate-request';

/**
 * Yayın sonrası cache purge'ü — API'nin `booking.page.purge` işi çağırır.
 *
 * Bu uç KRİTİK YOLDA DEĞİL: hiç çağrılmasa bile içerik `s-maxage=300` ile
 * en fazla beş dakika bayat kalır. Var olma sebebi o beş dakikayı saniyeye
 * indirmek — kullanıcı "Yayınla"ya bastıktan sonra sayfayı açıp eski hâli
 * görmesin.
 *
 * ⚠️ Middleware matcher'ından ve proxy beyaz listesinden DIŞLANMIŞ durumda.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const payload = (body ?? {}) as { slug?: unknown; tags?: unknown };

  const outcome = evaluateRevalidate({
    configuredSecret: serverEnv.revalidateSecret,
    providedSecret: request.headers.get('x-klinara-revalidate-secret'),
    slug: payload.slug,
    ...(payload.tags === undefined ? {} : { tags: payload.tags }),
  });

  if (!outcome.ok) {
    // Gövde yok: hangi kontrolün düştüğünü söylemek, sırrı arayan birine
    // hangi parçayı düzeltmesi gerektiğini öğretirdi.
    return new NextResponse(null, { status: outcome.status });
  }

  for (const tag of outcome.tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: outcome.tags, now: Date.now() });
}
