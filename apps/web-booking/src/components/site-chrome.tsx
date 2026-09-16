import Image from 'next/image';
import type { PublicSitePayload } from '@klinara/shared';
import { renderableBlocks } from '@/components/blocks/registry';
import { t } from '@/i18n/tr';

/**
 * Pazarlama sayfasının üst şeridi ve alt bilgisi.
 *
 * Sayfa bir kapakla başlıyordu ama ziyaretçi aşağı kaydırınca randevu düğmesi
 * de kliniğin adı da kayboluyordu. Şerit YAPIŞKAN: "Randevu al" her kaydırma
 * konumunda bir dokunuş uzakta. Bölüm bağlantıları yalnız sayfada o blok
 * VARSA çiziliyor — olmayan bir bölüme giden bağlantı, çalışmayan bağlantıdır.
 *
 * Sunucu bileşeni, JS yok.
 */
export function SiteHeader({ site }: { site: PublicSitePayload }) {
  const logo = site.theme.logo ?? null;
  const types = new Set(renderableBlocks(site.sections).map((block) => block.type));
  const links = [
    types.has('serviceList') ? { href: '#hizmetler', label: t('nav.services') } : null,
    types.has('faq') ? { href: '#sss', label: t('nav.faq') } : null,
    types.has('contact') ? { href: '#iletisim', label: t('nav.contact') } : null,
  ].filter((link) => link !== null);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <a href="/" className="flex min-w-0 items-center gap-2.5">
          {logo != null ? (
            <Image
              src={logo.url}
              alt={logo.alt ?? site.name}
              width={logo.width ?? 120}
              height={logo.height ?? 32}
              className="h-9 w-auto object-contain"
            />
          ) : (
            <span className="truncate text-base font-semibold tracking-tight">{site.name}</span>
          )}
        </a>

        <div className="flex items-center gap-6">
          {links.length > 0 && (
            <nav aria-label={t('nav.menu')} className="hidden items-center gap-6 text-sm font-medium md:flex">
              {links.map((link) => (
                <a key={link.href} href={link.href} className="opacity-70 transition hover:text-brand hover:opacity-100">
                  {link.label}
                </a>
              ))}
            </nav>
          )}
          <a
            href="/randevu"
            className="inline-flex shrink-0 items-center px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
            style={{ background: 'var(--brand-primary)', borderRadius: 'var(--brand-radius)' }}
          >
            {t('nav.book')}
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ site }: { site: PublicSitePayload }) {
  return (
    <footer className="mt-8 border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm opacity-70 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <span>{t('footer.rights', { year: new Date().getFullYear(), name: site.name })}</span>
        <a href="/randevu" className="hover:text-brand hover:underline">
          {t('footer.poweredBy')}
        </a>
      </div>
    </footer>
  );
}
