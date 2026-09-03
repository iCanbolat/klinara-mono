import Image from 'next/image';
import type { PublicSitePayload } from '@klinara/shared';
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
export function BookingHeader({ site }: { site: PublicSitePayload }) {
  const logo = site.theme.logo ?? null;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 lg:px-6">
        <a href="/" className="flex min-w-0 items-center gap-2.5">
          {logo != null ? (
            <Image
              src={logo.url}
              alt={logo.alt ?? site.name}
              width={logo.width ?? 120}
              height={logo.height ?? 32}
              className="h-8 w-auto object-contain"
            />
          ) : (
            <span className="truncate font-semibold tracking-tight">{site.name}</span>
          )}
        </a>

        <a
          href="/"
          className="shrink-0 text-xs opacity-60 underline-offset-4 transition-opacity hover:opacity-100 hover:underline"
        >
          {t('nav.backToSite')}
        </a>
      </div>
    </header>
  );
}
