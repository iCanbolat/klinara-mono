import { BookingHeader } from '@/components/booking-header';
import { BookingFlow } from '@/components/booking/booking-flow';
import { fetchServices, fetchSite } from '@/lib/api-server';

/**
 * Randevu akışının kabuğu.
 *
 * Site ve katalog SUNUCUDAN (ISR, tag'li) geliyor: ziyaretçiye özel değiller
 * ve ilk boyamayı hızlandırıyorlar. Uygunluk, tutma, OTP ve randevu ise
 * istemciden — hepsi IP bazlı hız sınırına tabi ya da mutasyon.
 */
export const revalidate = 300;

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [site, categories] = await Promise.all([fetchSite(slug), fetchServices(slug)]);

  return (
    <main className="min-h-dvh">
      <BookingHeader site={site} />
      <BookingFlow site={site} categories={categories} />
    </main>
  );
}
