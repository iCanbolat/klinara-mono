import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv, serverEnv } from '@/config/env';
import { isValidSlug } from '@/lib/cache-tags';

/**
 * Konak adı → slug çözümlemesi.
 *
 * Adres çubuğunda slug GÖRÜNMEZ: `/randevu` isteği içeride `/demo/randevu`'ya
 * yeniden yazılır. Bunun sebebi kozmetik değil — kanonik adres kiracının kendi
 * alan adıdır ve `<link rel="canonical">` onu gösterir; slug'ın URL'e sızması
 * aynı içeriğin iki adresten indekslenmesi demekti.
 *
 * Bilinmeyen konak adı `404` alır ve `no-store` ile döner: API'nin "yok ile
 * yayında değil ayırt edilmez" kararının istemci tarafındaki karşılığı, ve
 * negatif bir cevabı cache'lemek yeni bir kiracının ilk beş dakikasını
 * kırardı.
 */

interface CacheEntry {
  slug: string;
  canonicalUrl: string;
  expiresAt: number;
}

/**
 * Isolate içi çözümleme cache'i.
 *
 * API zaten `s-maxage=3600` diyor; bu katman aynı konak adı için art arda gelen
 * isteklerde ağ turunu tamamen atlıyor. Isolate başına olduğu için tutarlılık
 * garantisi yok — gerekmiyor da: yanlışlıkla eski bir slug 5 dakika yaşar.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;
/** Sınırsız büyüyen bir Map, rastgele Host başlıklarıyla bellek saldırısıdır. */
const CACHE_MAX_ENTRIES = 500;

/**
 * TEK matcher, uzantı dışlaması YOK.
 *
 * Uzantılı yolları dışlayan bir desen + `/robots.txt` için ikinci bir desen
 * denendi ve çalışmadı: Next 15.5'te çoklu matcher'da ilk girdinin negatif
 * lookahead'i kazanıyor ve middleware o yol için hiç koşmuyor. Dışlamayı
 * kaldırmak güvenli, çünkü uygulamanın `public/` altında servis edilen varlığı
 * yok — görseller CDN'den geliyor.
 */
export const config = {
  matcher: ['/((?!api|_next).*)'],
};

/**
 * Kök seviyedeki sabit dosyalar — middleware'den servis ediliyor.
 *
 * `app/robots.ts`, `app/robots.txt/route.ts` ve `public/robots.txt`in ÜÇÜ DE
 * denendi ve üçü de kök `[slug]` dinamik segmenti tarafından yutuldu: istek
 * slug'ı "robots.txt" sanılıp API'ye gidiyor ve 404'e düşüyordu. Middleware
 * yönlendirmeden ÖNCE koştuğu için önceliği tartışmasız — çok kiracılı bir
 * kökte tek güvenilir yer burası.
 */
const ROBOTS = `User-agent: *
Allow: /
Disallow: /randevu
Disallow: /r/
Disallow: /api/
`;

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<rect width="32" height="32" rx="7" fill="#0F766E"/>` +
  `<path d="M9 12h14M9 17h14M9 22h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` +
  `</svg>`;

function staticFile(pathname: string): NextResponse | null {
  if (pathname === '/robots.txt') {
    return new NextResponse(ROBOTS, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
  }
  if (pathname === '/icon.svg' || pathname === '/favicon.ico') {
    return new NextResponse(ICON, {
      headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
    });
  }
  return null;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const asset = staticFile(request.nextUrl.pathname);
  if (asset !== null) return asset;

  const host = normalizeHost(
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '',
  );

  const slug = await resolveSlug(host, request);
  if (slug === null) {
    return NextResponse.rewrite(new URL('/unknown.host', request.url), {
      headers: { 'cache-control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  url.pathname = `/${slug}${request.nextUrl.pathname}`;
  const response = NextResponse.rewrite(url);
  // RSC'ler slug'ı tekrar çözmesin diye taşınıyor.
  response.headers.set('x-klinara-slug', slug);
  return response;
}

async function resolveSlug(host: string, request: NextRequest): Promise<string | null> {
  // Yerel kaçış yolu: wildcard DNS'i olmayan bir makinede `?__slug=` ile
  // çalışılabilsin. Üretimde YOK — aksi hâlde herkes her kiracının sayfasını
  // kendi alan adından açabilirdi.
  if (serverEnv.nodeEnv !== 'production') {
    const override = request.nextUrl.searchParams.get('__slug') ?? publicEnv.devSlug;
    if (host === '' || host.startsWith('localhost')) {
      return isValidSlug(override) ? override : null;
    }
  }
  if (host === '') return null;

  const now = Date.now();
  const cached = cache.get(host);
  if (cached !== undefined && cached.expiresAt > now) return cached.slug;

  try {
    const response = await fetch(
      `${serverEnv.apiInternalUrl}/public/resolve?host=${encodeURIComponent(host)}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { slug?: unknown; canonicalUrl?: unknown };
    if (!isValidSlug(body.slug)) return null;

    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    cache.set(host, {
      slug: body.slug,
      canonicalUrl: typeof body.canonicalUrl === 'string' ? body.canonicalUrl : '',
      expiresAt: now + CACHE_TTL_MS,
    });
    return body.slug;
  } catch {
    // API erişilemezse sayfayı kırma yerine bilinmeyen konak ekranı göster.
    return null;
  }
}

/** Port ve sondaki noktayı kırp, küçük harfe indir — API'nin `common/host.ts`'i ile aynı kural. */
function normalizeHost(raw: string): string {
  return raw.toLowerCase().split(':')[0]?.replace(/\.$/, '') ?? '';
}
