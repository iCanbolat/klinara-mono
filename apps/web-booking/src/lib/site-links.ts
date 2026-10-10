import type { PublicSitePayload } from '@klinara/shared';

/**
 * Sayfa içi bağlantıların TEK üreteci.
 *
 * İki adresleme biçimi var. Kiracının kendi konak adında (`klinik.klinara.app`,
 * özel alan adı) slug adres çubuğunda görünmez ve yollar köke göredir. Doğrudan
 * randevu bağlantısında (`klinara.app/randevu?klinik=…`) konak adı platformun
 * kendisidir; kiracıyı taşıyan tek şey `klinik` parametresi, yani her bağlantı
 * onu yeniden taşımak zorunda. Bağlantılar bileşenlere dağılsaydı biri
 * parametreyi unutur ve ziyaretçi platformun 404'üne düşerdi.
 */
export const DIRECT_PARAM = 'klinik';

type LinkSite = Pick<PublicSitePayload, 'slug' | 'published' | 'canonicalUrl'>;

export function bookingHref(site: LinkSite, direct: boolean): string {
  return direct ? `/randevu?${DIRECT_PARAM}=${site.slug}` : '/randevu';
}

export function manageHref(site: LinkSite, token: string, direct: boolean): string {
  return direct ? `/r/${token}?${DIRECT_PARAM}=${site.slug}` : `/r/${token}`;
}

/**
 * Kliniğin tanıtım sayfası; yoksa `null`.
 *
 * Sayfa yayında değilse dönülecek bir yer yok. Doğrudan bağlantıda `/`
 * platformun kendi sitesidir, kliniğin değil — oradan yalnız kanonik adrese
 * gidilir.
 */
export function homeHref(site: LinkSite, direct: boolean): string | null {
  if (!site.published) return null;
  if (!direct) return '/';
  return site.canonicalUrl === '' ? null : site.canonicalUrl;
}
