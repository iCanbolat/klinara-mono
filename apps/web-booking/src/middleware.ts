import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv, serverEnv } from '@/config/env';
import { isValidSlug } from '@/lib/cache-tags';
import { DIRECT_PARAM } from '@/lib/site-links';

/**
 * Konak adı → slug çözümlemesi.
 *
 * Adres çubuğunda slug GÖRÜNMEZ: `/randevu` isteği içeride `/demo/randevu`'ya
 * yeniden yazılır. Bunun sebebi kozmetik değil — kanonik adres kiracının kendi
 * alan adıdır ve `<link rel="canonical">` onu gösterir; slug'ın URL'e sızması
 * aynı içeriğin iki adresten indekslenmesi demekti.
 *
 * DOĞRUDAN RANDEVU BAĞLANTISI: platformun kök konak adında (`klinara.app`)
 * kiracıyı konak adı değil `?klinik=` parametresi seçer —
 * `klinara.app/randevu?klinik=demo`. Sayfa içeriğini yayınlamamış klinik bu
 * adresi paylaşır; onun platform subdomain'i de buraya yönlendirilir.
 *
 * Bilinmeyen konak adı `404` alır ve `no-store` ile döner: API'nin "yok ile
 * yayında değil ayırt edilmez" kararının istemci tarafındaki karşılığı, ve
 * negatif bir cevabı cache'lemek yeni bir kiracının ilk beş dakikasını
 * kırardı.
 */

interface Resolution {
  slug: string;
  /** Sayfası yayında olmayan platform subdomain'inin yönlendirileceği adres. */
  directUrl: string | null;
}

interface CacheEntry extends Resolution {
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
 *
 * `preview.frame` dışlanıyor: yönetim panelinin önizleme iframe'i o rotayı yüklüyor
 * ve dışlanmasaydı `[slug]` segmenti onu da yutar, "preview.frame" bir slug sanılıp
 * API'ye sorulurdu (Faz 11.1'de `/robots.txt` ile yaşanan hatanın aynısı).
 */
export const config = {
  matcher: ['/((?!api|_next|preview\\.frame).*)'],
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
Disallow: /preview.frame
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

  const { pathname } = request.nextUrl;

  if (isPlatformRoot(host)) {
    const slug = request.nextUrl.searchParams.get(DIRECT_PARAM);
    const target = directRoute(pathname);
    if (target === null || !isValidSlug(slug)) return unknownHost(request);
    return rewriteTo(request, slug, target);
  }

  const resolved = await resolveSlug(host, request);
  // `/direkt` yalnız kök konak adının iç rotası; kiracı konak adından
  // açılırsa aynı akışın ikinci bir adresi olurdu.
  if (resolved === null || pathname === DIRECT_ROUTE || pathname.startsWith(`${DIRECT_ROUTE}/`)) {
    return unknownHost(request);
  }

  if (resolved.directUrl !== null) {
    // 307, 308 değil: klinik sayfasını yayınladığı an subdomain kendi içeriğini
    // göstermeye başlamalı; kalıcı yönlendirme tarayıcıda yapışıp kalırdı.
    return NextResponse.redirect(directRedirect(resolved.directUrl, pathname), {
      status: 307,
      headers: { 'cache-control': 'no-store' },
    });
  }

  return rewriteTo(request, resolved.slug, pathname);
}

/** Doğrudan randevu rotalarının `[slug]` altındaki iç öneki. */
const DIRECT_ROUTE = '/direkt';

function isPlatformRoot(host: string): boolean {
  return host === publicEnv.bookingDomain || host === `www.${publicEnv.bookingDomain}`;
}

/**
 * Kök konak adında sunulan yollar → `[slug]` altındaki iç rota.
 *
 * Yalnız randevu akışı ve self-servis; kökün geri kalanı (tanıtım sitesi) bu
 * uygulamanın değil.
 */
function directRoute(pathname: string): string | null {
  if (pathname === '/randevu') return DIRECT_ROUTE;
  if (/^\/r\/[^/]+$/.test(pathname)) return `${DIRECT_ROUTE}${pathname}`;
  return null;
}

/**
 * Subdomain'deki self-servis bağlantısı (`/r/{token}`) yönlendirmede de
 * randevusuna varmalı; geri kalan her yol randevu akışına gider.
 */
function directRedirect(directUrl: string, pathname: string): URL {
  const url = new URL(directUrl);
  if (directRoute(pathname) !== null) url.pathname = pathname;
  return url;
}

function rewriteTo(request: NextRequest, slug: string, pathname: string): NextResponse {
  const url = new URL(request.url);
  url.pathname = `/${slug}${pathname}`;
  const response = NextResponse.rewrite(url);
  // RSC'ler slug'ı tekrar çözmesin diye taşınıyor.
  response.headers.set('x-klinara-slug', slug);
  return response;
}

function unknownHost(request: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL('/unknown.host', request.url), {
    headers: { 'cache-control': 'no-store' },
  });
}

async function resolveSlug(host: string, request: NextRequest): Promise<Resolution | null> {
  // Yerel kaçış yolu: wildcard DNS'i olmayan bir makinede `?__slug=` ile
  // çalışılabilsin. Üretimde YOK — aksi hâlde herkes her kiracının sayfasını
  // kendi alan adından açabilirdi.
  if (serverEnv.nodeEnv !== 'production') {
    const override = request.nextUrl.searchParams.get('__slug') ?? publicEnv.devSlug;
    if (host === '' || host.startsWith('localhost')) {
      return isValidSlug(override) ? { slug: override, directUrl: null } : null;
    }
  }
  if (host === '') return null;

  const now = Date.now();
  const cached = cache.get(host);
  if (cached !== undefined && cached.expiresAt > now) return cached;

  try {
    const response = await fetch(
      `${serverEnv.apiInternalUrl}/public/resolve?host=${encodeURIComponent(host)}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { slug?: unknown; directUrl?: unknown };
    if (!isValidSlug(body.slug)) return null;

    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    const resolution: Resolution = {
      slug: body.slug,
      directUrl: typeof body.directUrl === 'string' ? body.directUrl : null,
    };
    cache.set(host, { ...resolution, expiresAt: now + CACHE_TTL_MS });
    return resolution;
  } catch {
    // API erişilemezse sayfayı kırma yerine bilinmeyen konak ekranı göster.
    return null;
  }
}

/** Port ve sondaki noktayı kırp, küçük harfe indir — API'nin `common/host.ts`'i ile aynı kural. */
function normalizeHost(raw: string): string {
  return raw.toLowerCase().split(':')[0]?.replace(/\.$/, '') ?? '';
}
