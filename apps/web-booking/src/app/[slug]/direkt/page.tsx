import { BookingHeader } from '@/components/booking-header';
import { BookingFlow } from '@/components/booking/booking-flow';
import { fetchServices, fetchSite } from '@/lib/api-server';

/**
 * Doğrudan randevu bağlantısı — `{kök}/randevu?klinik={slug}`.
 *
 * Middleware platformun kök konak adındaki `/randevu` isteğini buraya yazar.
 * Sayfa içeriğini yayınlamamış klinik bu adresi paylaşır: pazarlama sayfası
 * yok, yalnız akış. `[slug]/randevu` ile aynı kabuk; farkı bağlantıların
 * `klinik` parametresini taşıması (`lib/site-links.ts`).
 */
export const revalidate = 300;

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function DirectBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [site, categories] = await Promise.all([fetchSite(slug), fetchServices(slug)]);

  return (
    <main className="min-h-dvh">
      <BookingHeader site={site} direct />
      <BookingFlow site={site} categories={categories} direct />
    </main>
  );
}
