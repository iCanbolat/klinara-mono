import Image from 'next/image';
import type { PublicSitePayload } from '@klinara/shared';
import { homeHref } from '@/lib/site-links';
import { t } from '@/i18n/tr';

/**
 * Randevu sayfasının marka başlığı.
 *
 * `theme.logo` Faz 9'dan beri yükte geliyordu ama HİÇ çizilmiyordu: sayfa
 * tamamen çıplak açılıyor, ziyaretçi hangi kliniğe randevu aldığını yalnız
 * adres çubuğundan anlıyordu. White-label bir üründe bu bir eksik değil,
 * ürünün kendisinin görünmemesi.
 *
 * Sunucu bileşeni ve `priority` YOK: LCP adayı randevu kartı, logo değil.
 */
export function BookingHeader({
  site,
  direct = false,
}: {
  site: PublicSitePayload;
  /** Doğrudan randevu bağlantısı (`{kök}/randevu?klinik=`) — bkz. `lib/site-links.ts`. */
  direct?: boolean;
}) {
  const logo = site.theme.logo ?? null;
  // Sayfa yayında değilse dönülecek bir tanıtım sayfası yok: marka yalnız
  // gösterilir, bağlantı olmaz.
  const home = homeHref(site, direct);
  const brand =
    logo != null ? (
      <Image
        src={logo.url}
        alt={logo.alt ?? site.name}
        width={logo.width ?? 120}
        height={logo.height ?? 32}
        className="h-8 w-auto object-contain"
      />
    ) : (
      <span className="truncate font-semibold tracking-tight">{site.name}</span>
    );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 lg:px-6">
        {home === null ? (
          <div className="flex min-w-0 items-center gap-2.5">{brand}</div>
        ) : (
          <a href={home} className="flex min-w-0 items-center gap-2.5">
            {brand}
          </a>
        )}

        {home !== null && (
          <a
            href={home}
            className="shrink-0 text-xs opacity-60 underline-offset-4 transition-opacity hover:opacity-100 hover:underline"
          >
            {t('nav.backToSite')}
          </a>
        )}
      </div>
    </header>
  );
}
