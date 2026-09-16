import { RenderBlocks } from '@/components/blocks/registry';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { fetchServices, fetchSite } from '@/lib/api-server';

/**
 * Pazarlama sayfası — ISR.
 *
 * Veri `next: { tags, revalidate: 300 }` ile çekiliyor: yayın sonrası API'nin
 * purge işi (`/api/revalidate`) etiketi düşürüyor ve sayfa saniyeler içinde
 * tazeleniyor; purge ulaşmazsa 300 sn'lik TTL yedekte kalıyor.
 */
export const revalidate = 300;

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [site, categories] = await Promise.all([fetchSite(slug), fetchServices(slug)]);

  return (
    <>
      <SiteHeader site={site} />
      <main>
        <RenderBlocks sections={site.sections} ctx={{ site, categories }} />
      </main>
      <SiteFooter site={site} />
    </>
  );
}
