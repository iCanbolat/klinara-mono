import Image from 'next/image';
import type {
  CarouselBlock,
  ContactBlock,
  HeroBlock,
  MapBlock,
  PublicCategory,
  PublicImage,
  PublicSitePayload,
  RichTextBlock,
  ServiceListBlock,
} from '@klinara/shared';
import { CONTENT_LIMITS } from '@klinara/shared';
import { Markdown } from './markdown';
import { t } from '@/i18n/tr';

/**
 * Pazarlama blokları — HEPSİ sunucu bileşeni.
 *
 * Tek bir Radix importu bu ağacı istemciye taşır ve 11.1'in Lighthouse >= 90 /
 * LCP < 2.0 s kriterini düşürür; sınır `eslint.config.js`'te zorlanıyor.
 * Carousel bu yüzden JS'siz `scroll-snap`, harita ise tıkla-yükle poster
 * arkasında duruyor.
 */

export interface BlockContext {
  site: PublicSitePayload;
  categories: PublicCategory[];
  /** Sayfadaki İLK görsel mi — `priority` yalnız ona verilir (LCP). */
  isFirst: boolean;
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
  // Sunucu `width`/`height` gönderiyorsa oranı koruyalım; göndermiyorsa
  // `fill` ile kaba çerçeveye yerleşsin — CLS'i ikisi de engelliyor.
  if (image.width !== null && image.height !== null) {
    return (
      <Image
        src={image.url}
        alt={image.alt ?? ''}
        width={image.width}
        height={image.height}
        sizes={sizes}
        priority={priority}
        className={className ?? 'h-auto w-full object-cover'}
      />
    );
  }
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
    <section className="relative isolate overflow-hidden" style={{ borderRadius: 'var(--brand-radius)' }}>
      {image !== null && (
        <div className="absolute inset-0 -z-10">
          <Figure image={image} priority={ctx.isFirst} sizes="100vw" />
          <div className="absolute inset-0 bg-black/35" />
        </div>
      )}
      <div
        className={`mx-auto flex max-w-4xl flex-col items-start gap-4 px-6 py-20 ${
          image === null ? '' : 'text-white'
        }`}
      >
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{block.title}</h1>
        {block.subtitle !== undefined && (
          <p className="max-w-2xl text-lg opacity-90">{block.subtitle}</p>
        )}
        <a
          href="/randevu"
          className="mt-2 inline-flex items-center px-6 py-3 font-medium text-white"
          style={{ background: 'var(--brand-primary)', borderRadius: 'var(--brand-radius)' }}
        >
          {block.ctaLabel ?? t('nav.book')}
        </a>
      </div>
    </section>
  );
}

export function RichText({ block }: { block: RichTextBlock }) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      {block.title !== undefined && <h2 className="text-2xl font-semibold">{block.title}</h2>}
      <Markdown source={block.body} />
    </section>
  );
}

export function Carousel({ block, ctx }: { block: CarouselBlock; ctx: BlockContext }) {
  const items = block.items.filter((item) => item.image != null);
  if (items.length === 0) return null;

  return (
    <section className="py-12">
      {block.title !== undefined && (
        <h2 className="mx-auto max-w-5xl px-6 pb-4 text-2xl font-semibold">{block.title}</h2>
      )}
      {/* JS yok: yatay kaydırma + scroll-snap. Bir carousel kütüphanesi burada
          hem istemci bundle'ı hem de erişilebilirlik borcu demekti. */}
      <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2">
        {items.map((item, index) => {
          const image = item.image;
          if (image == null) return null;
          return (
            <li
              key={index}
              className="relative w-72 shrink-0 snap-start overflow-hidden"
              style={{ borderRadius: 'var(--brand-radius)' }}
            >
              <div className="relative aspect-4/3">
                <Figure
                  image={{ ...image, alt: item.alt ?? image.alt }}
                  priority={ctx.isFirst && index === 0}
                  sizes="288px"
                />
              </div>
              {item.caption !== undefined && (
                <p className="px-1 pt-2 text-sm opacity-75">{item.caption}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ServiceList({ block, ctx }: { block: ServiceListBlock; ctx: BlockContext }) {
  // `categoryIds` yalnız bir SÜZGEÇ; hizmetin online alınabilir olup olmadığına
  // sunucu karar veriyor ve listeye zaten yalnız açık olanlar geliyor.
  const filter = block.categoryIds ?? [];
  const categories =
    filter.length === 0 ? ctx.categories : ctx.categories.filter((c) => filter.includes(c.id));
  const showPrices = ctx.site.settings.showPrices;

  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      {block.title !== undefined && <h2 className="text-2xl font-semibold">{block.title}</h2>}
      {categories.length === 0 ? (
        <p className="mt-4 opacity-70">{t('block.services.empty')}</p>
      ) : (
        categories.map((category) => (
          <div key={category.id} className="mt-8">
            <h3 className="text-lg font-medium opacity-80">{category.name}</h3>
            <ul className="mt-3 divide-y divide-black/10">
              {category.services.map((service) => (
                <li key={service.id} className="flex items-baseline justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium">{service.name}</p>
                    {service.description !== null && (
                      <p className="text-sm opacity-70">{service.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-sm opacity-80">
                    <span>
                      {service.durationMinutes} {t('common.minutes')}
                    </span>
                    {/* `showPrices` kapalıyken fiyat DÜĞÜMÜ hiç yok — sunucu
                        anahtarı zaten göndermiyor, istemci de `0 TL` yazamasın. */}
                    {showPrices && service.priceMinor !== undefined && (
                      <span className="ml-3 font-medium">
                        {formatMinor(service.priceMinor, service.currency ?? ctx.site.currency)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

export function Contact({ block, ctx }: { block: ContactBlock; ctx: BlockContext }) {
  const showPhones = block.showPhones ?? true;
  const showAddresses = block.showAddresses ?? true;

  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      {block.title !== undefined && <h2 className="text-2xl font-semibold">{block.title}</h2>}
      <ul className="mt-6 grid gap-6 sm:grid-cols-2">
        {ctx.site.branches.map((branch) => (
          <li
            key={branch.id}
            className="border border-black/10 p-4"
            style={{ borderRadius: 'var(--brand-radius)' }}
          >
            <p className="font-medium">{branch.name}</p>
            {showAddresses && branch.address !== null && (
              <p className="mt-1 text-sm opacity-75">{branch.address}</p>
            )}
            {showPhones && branch.phone !== null && (
              <a href={`tel:${branch.phone}`} className="mt-2 inline-block text-sm underline">
                {branch.phone}
              </a>
            )}
          </li>
        ))}
      </ul>
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
    <section className="mx-auto max-w-4xl px-6 py-12">
      {/* `loading="lazy"` şart: üçüncü taraf bir iframe'i hemen yüklemek LCP'yi
          bizim kontrolümüz dışına çıkarır. */}
      <iframe
        src={src}
        title={target.name}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="h-80 w-full border-0"
        style={{ borderRadius: 'var(--brand-radius)' }}
      />
    </section>
  );
}

function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}
