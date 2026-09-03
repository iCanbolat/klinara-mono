import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAMES, isExpired, type AccessPayload } from '@/lib/session/cookies';
import { unseal } from '@/lib/session/seal';

/**
 * Rota koruması — ilk katman, AĞ ÇAĞRISI YOK.
 *
 * Yaptığı tek iş: kimliksiz bir ziyaretçinin panel kabuğunu (iskelet, menü,
 * sayfa başlığı) hiç görmemesini sağlamak. Yetkinin otoritesi burası DEĞİL —
 * o, her veri çağrısında API'nin `PermissionsGuard`'ı.
 *
 * ⚠️ SÜRESİ DOLMUŞ TOKEN GİRİŞE DÜŞÜRMÜYOR. Erişim token'ı 15 dakikalık ve
 * yenilemesi tarayıcıda; burada `exp`e bakıp yönlendirmek, sekmesini bir saat
 * açık bırakan herkesi gereksiz yere girişe atardı. Cookie'nin VARLIĞI
 * yeterli; geçersizse ilk veri çağrısı 401 döner ve `SessionProvider` doğru
 * kurtarmayı yapar.
 *
 * Edge runtime'da koşuyor; `seal.ts`in `node:crypto` yerine WebCrypto
 * kullanmasının sebebi tam olarak bu satır.
 */

/** Girişsiz erişilebilen rotalar. */
const PUBLIC_PREFIXES = ['/giris', '/parola', '/davet'];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const sealed = request.cookies.get(COOKIE_NAMES.access)?.value;
  const payload = sealed === undefined ? null : await unseal<AccessPayload>(sealed, 'at');
  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (payload === null) {
    if (isPublic) return NextResponse.next();
    const login = new URL('/giris', request.url);
    // Kullanıcı giriş yaptıktan sonra gitmek istediği yere dönsün. Yalnız
    // göreli yol taşınıyor — açık yönlendirme (open redirect) olmasın diye
    // tam URL asla kabul edilmiyor.
    if (pathname !== '/') login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  // Oturumu olan kullanıcı giriş ekranlarında oyalanmasın. Süresi TAMAMEN
  // dolmuş bir token'da bu yönlendirmeyi yapmıyoruz: kullanıcı yeniden giriş
  // yapmak isteyebilir ve onu kapağa geri atmak kilitlenme hissi verir.
  if (isPublic && !isExpired(payload, Date.now()) && !pathname.startsWith('/davet')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // `api` hariç: oturum ve proxy uçlarının kendi kontrolleri var ve buradan
  // geçmeleri 401 yerine 307 dönmelerine yol açardı — istemci JSON beklerken
  // HTML alırdı.
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};
