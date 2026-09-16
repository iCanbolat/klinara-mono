import Image from 'next/image';
import { ChevronDown, Clock, MapPin, Navigation, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  CarouselBlock,
  ContactBlock,
  FaqBlock,
  HeroBlock,
  MapBlock,
  PublicCategory,
  PublicImage,
  PublicService,
  PublicSitePayload,
  RichTextBlock,
  ServiceListBlock,
} from '@klinara/shared';
import { CONTENT_LIMITS } from '@klinara/shared';
import { GalleryCarousel } from './gallery-carousel';
import { Markdown } from './markdown';
import { ServiceTabs } from './service-tabs';
import { t } from '@/i18n/tr';

/**
 * Pazarlama blokları — varsayılan olarak SUNUCU bileşeni.
 *
 * Radix importu bu ağaca GİRMEZ (`eslint.config.js`): tek bir import istemci
 * bundle'ını public sayfaya taşır ve 11.1'in Lighthouse >= 90 / LCP < 2.0 s
 * kriterini düşürür. İki küçük ada var ve ikisi de kütüphanesiz: galeri ok
 * düğmeleri (`gallery-carousel.tsx`) ve hizmet kategorisi sekmeleri
 * (`service-tabs.tsx`). İkisinde de içerik sunucuda çiziliyor; JS yüklenmeden
 * sayfa eksiksiz okunabiliyor. SSS akordeonu yerel `<details>`: sıfır JS.
 *
 * HİZALAMA TEK YERDE: her blok aynı `Container`ı kullanıyor. Bloklar kendi
 * `max-w`lerini seçtiğinde başlıklar sayfa boyunca zikzak çiziyordu.
 */

export interface BlockContext {
  site: PublicSitePayload;
  categories: PublicCategory[];
  /** Sayfadaki İLK görsel mi — `priority` yalnız ona verilir (LCP). */
  isFirst: boolean;
}

/** Bloklar için ortak yatay ızgara. */
function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

function SectionHeading({ title, eyebrow }: { title: string | undefined; eyebrow?: string }) {
  if (title === undefined || title.trim() === '') return null;
  return (
    <div className="mb-8 flex flex-col gap-2">
      {eyebrow !== undefined && (
        <span className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">{eyebrow}</span>
      )}
      <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h2>
    </div>
  );
}

function Figure({
  image,
  priority,
  sizes,
  className,
}: {
  image: PublicImage;
  priority: boolean;
  sizes: string;
  className?: string;
}) {
  return (
    <Image
      src={image.url}
      alt={image.alt ?? ''}
      fill
      sizes={sizes}
      priority={priority}
      className={className ?? 'object-cover'}
    />
  );
}

export function Hero({ block, ctx }: { block: HeroBlock; ctx: BlockContext }) {
  const image = block.image ?? null;
  return (
    // Tam genişlik ve KÖŞESİZ: kapak sayfanın zemini, bir kart değil. Görsel
    // `fill` + `object-cover` ile her en-boy oranında alanı kaplıyor; yükseklik
    // ekrana göre büyüyor ama dev ekranda sonsuza uzamıyor.
    <section
      className={`relative isolate flex min-h-[26rem] items-end overflow-hidden sm:min-h-[32rem] lg:min-h-[min(40rem,78svh)] ${
        image === null ? 'bg-brand-soft' : 'text-white'
      }`}
    >
      {image !== null && (
        <div className="absolute inset-0 -z-10">
          <Figure image={image} priority={ctx.isFirst} sizes="100vw" className="object-cover object-center" />
          {/* Alttan koyulaşan örtü: metin her görselde okunur kalır, üst kısım fotoğrafı öldürmez. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
        </div>
      )}
      <Container className="py-14 sm:py-20">
        <div className="flex max-w-2xl flex-col items-start gap-5">
          <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            {block.title}
          </h1>
          {block.subtitle !== undefined && (
            <p className="text-lg text-pretty opacity-90 sm:text-xl">{block.subtitle}</p>
          )}
          <a
            href="/randevu"
            className="mt-2 inline-flex items-center gap-2 px-6 py-3.5 font-medium text-white shadow-lg shadow-black/10 transition hover:brightness-110"
            style={{ background: 'var(--brand-primary)', borderRadius: 'var(--brand-radius)' }}
          >
            {block.ctaLabel ?? t('nav.book')}
          </a>
        </div>
      </Container>
    </section>
  );
}

export function RichText({ block }: { block: RichTextBlock }) {
  return (
    <section className="py-14 sm:py-20">
      <Container>
        <SectionHeading title={block.title} />
        <div className="max-w-3xl text-lg leading-relaxed opacity-90">
          <Markdown source={block.body} />
        </div>
      </Container>
    </section>
  );
}

export function Carousel({ block, ctx }: { block: CarouselBlock; ctx: BlockContext }) {
  const items = block.items.filter((item) => item.image != null);
  if (items.length === 0) return null;

  return (
    <section className="py-14 sm:py-20">
      <Container>
        <SectionHeading title={block.title} />
      </Container>
      {/* Şerit container DIŞINDA: geniş ekranda kenarlara taşarak kayabiliyor,
          ama iç boşluk container ile aynı, yani ilk öge başlıkla hizalı. */}
      <div className="mx-auto max-w-6xl">
        <GalleryCarousel label={block.title ?? t('block.gallery.label')}>
          {items.map((item, index) => {
            const image = item.image;
            if (image == null) return null;
            return (
              <li
                key={index}
                className="w-[82%] shrink-0 snap-center sm:w-[calc(50%-10px)] sm:snap-start lg:w-[calc(33.333%-14px)]"
              >
                <figure>
                  <div
                    className="relative aspect-[4/3] overflow-hidden bg-black/5"
                    style={{ borderRadius: 'var(--brand-radius)' }}
                  >
                    <Figure
                      image={{ ...image, alt: item.alt ?? image.alt }}
                      priority={ctx.isFirst && index === 0}
                      sizes="(min-width: 1280px) 380px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 82vw"
                      className="object-cover transition-transform duration-500 hover:scale-[1.03]"
                    />
                  </div>
                  {item.caption !== undefined && (
                    <figcaption className="px-1 pt-3 text-sm leading-snug opacity-75">{item.caption}</figcaption>
                  )}
                </figure>
              </li>
            );
          })}
        </GalleryCarousel>
      </div>
    </section>
  );
}

export function ServiceList({ block, ctx }: { block: ServiceListBlock; ctx: BlockContext }) {
  // `categoryIds` yalnız bir SÜZGEÇ; hizmetin online alınabilir olup olmadığına
  // sunucu karar veriyor ve listeye zaten yalnız açık olanlar geliyor.
  const filter = block.categoryIds ?? [];
  const categories = (
    filter.length === 0 ? ctx.categories : ctx.categories.filter((c) => filter.includes(c.id))
  ).filter((category) => category.services.length > 0);
  const showPrices = ctx.site.settings.showPrices;
  const currency = ctx.site.currency;

  return (
    <section id="hizmetler" className="scroll-mt-20 py-14 sm:py-20">
      <Container>
        <SectionHeading title={block.title} />
        {categories.length === 0 ? (
          <p className="opacity-70">{t('block.services.empty')}</p>
        ) : categories.length === 1 ? (
          <ServiceGrid services={categories[0]?.services ?? []} showPrices={showPrices} currency={currency} />
        ) : (
          // Uzun katalogda tek liste kaydırmayı sonsuzlaştırıyordu; kategori
          // başına sekme. Tek kategoride sekme gürültü olurdu, düz liste kalıyor.
          <ServiceTabs
            label={block.title ?? t('nav.services')}
            tabs={categories.map((category) => ({
              id: category.id,
              label: category.name,
              count: category.services.length,
              panel: <ServiceGrid services={category.services} showPrices={showPrices} currency={currency} />,
            }))}
          />
        )}
      </Container>
    </section>
  );
}

function ServiceGrid({
  services,
  showPrices,
  currency,
}: {
  services: readonly PublicService[];
  showPrices: boolean;
  currency: string;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {services.map((service) => (
        <li
          key={service.id}
          className="flex flex-col justify-between gap-4 border border-line bg-card p-5 transition hover:border-line-strong hover:shadow-sm"
          style={{ borderRadius: 'var(--brand-radius)' }}
        >
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-semibold">{service.name}</p>
            {service.description !== null && (
              <p className="line-clamp-3 text-sm leading-relaxed opacity-70">{service.description}</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 opacity-70">
                <Clock aria-hidden="true" className="size-4" />
                {service.durationMinutes} {t('common.minutes')}
              </span>
              {/* `showPrices` kapalıyken fiyat DÜĞÜMÜ hiç yok — sunucu
                  anahtarı zaten göndermiyor, istemci de `0 TL` yazamasın. */}
              {showPrices && service.priceMinor !== undefined && (
                <span className="font-semibold tabular-nums">
                  {formatMinor(service.priceMinor, service.currency ?? currency)}
                </span>
              )}
            </div>
            <a
              href="/randevu"
              className="shrink-0 text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              {t('nav.book')}
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Faq({ block }: { block: FaqBlock }) {
  const items = block.items.filter((item) => item.question.trim() !== '');
  if (items.length === 0) return null;

  return (
    <section id="sss" className="scroll-mt-20 py-14 sm:py-20">
      <Container>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
          <SectionHeading title={block.title} />
          {/* Yerel `<details>`: klavye, ekran okuyucu ve sayfa içi arama
              (Ctrl+F kapalı cevabı da açar) tarayıcıdan geliyor, JS sıfır. */}
          <div className="divide-y divide-line border-y border-line">
            {items.map((item, index) => (
              <details key={index} className="group" name="sss">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-base font-medium transition hover:text-brand sm:text-lg [&::-webkit-details-marker]:hidden">
                  <span>{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 opacity-60 transition-transform duration-200 group-open:rotate-180"
                  />
                </summary>
                <p className="pb-5 leading-relaxed whitespace-pre-line opacity-80">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

export function Contact({ block, ctx }: { block: ContactBlock; ctx: BlockContext }) {
  const showPhones = block.showPhones ?? true;
  const showAddresses = block.showAddresses ?? true;

  return (
    <section id="iletisim" className="scroll-mt-20 py-14 sm:py-20">
      <Container>
        <SectionHeading title={block.title} />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ctx.site.branches.map((branch) => (
            <li
              key={branch.id}
              className="flex flex-col gap-3 border border-line bg-card p-5"
              style={{ borderRadius: 'var(--brand-radius)' }}
            >
              <p className="text-base font-semibold">{branch.name}</p>
              {showAddresses && branch.address !== null && (
                <p className="flex gap-2 text-sm leading-relaxed opacity-75">
                  <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {branch.address}
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm font-medium">
                {showPhones && branch.phone !== null && (
                  <a href={`tel:${branch.phone}`} className="inline-flex items-center gap-1.5 text-brand hover:underline">
                    <Phone aria-hidden="true" className="size-4" />
                    {formatPhone(branch.phone)}
                  </a>
                )}
                {branch.address !== null && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${branch.name} ${branch.address}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-brand hover:underline"
                  >
                    <Navigation aria-hidden="true" className="size-4" />
                    {t('block.contact.directions')}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

export function MapBlockView({ block, ctx }: { block: MapBlock; ctx: BlockContext }) {
  const branches =
    block.branchId === undefined
      ? ctx.site.branches
      : ctx.site.branches.filter((branch) => branch.id === block.branchId);
  const target = branches.find((branch) => branch.address !== null);
  if (target?.address == null) return null;

  const zoom = block.zoom ?? CONTENT_LIMITS.map.zoom.default;
  const query = encodeURIComponent(`${target.name} ${target.address}`);
  const src = `https://www.google.com/maps?q=${query}&z=${zoom}&output=embed`;

  return (
    <section className="pb-14 sm:pb-20">
      <Container>
        {/* `loading="lazy"` şart: üçüncü taraf bir iframe'i hemen yüklemek LCP'yi
            bizim kontrolümüz dışına çıkarır. */}
        <iframe
          src={src}
          title={target.name}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="h-72 w-full border-0 sm:h-96"
          style={{ borderRadius: 'var(--brand-radius)' }}
        />
      </Container>
    </section>
  );
}

function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

/** `+902121234567` → `+90 212 123 45 67`; tanınmayan biçim olduğu gibi kalır. */
function formatPhone(phone: string): string {
  const match = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match === null ? phone : `+90 ${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
}
