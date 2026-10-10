import { redirect } from 'next/navigation';
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

  // Sayfa içeriği yayında değil: gösterilecek blok yok, yalnız randevu akışı
  // var. Buraya ancak ÖZEL alan adından düşülür — platform subdomain'ini
  // middleware doğrudan randevu bağlantısına yönlendiriyor.
  if (!site.published) redirect('/randevu');

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
