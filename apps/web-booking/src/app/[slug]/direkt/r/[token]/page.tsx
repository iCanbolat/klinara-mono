import { AppointmentView } from '@/components/selfservice/appointment-view';
import { fetchServices, fetchSite } from '@/lib/api-server';

/**
 * Self-servis sayfasının doğrudan bağlantı karşılığı — `{kök}/r/{token}?klinik={slug}`.
 *
 * `[slug]/r/[token]` ile aynı kurallar: `force-dynamic`, randevu istemciden.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function DirectSelfServicePage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const [site, categories] = await Promise.all([fetchSite(slug), fetchServices(slug)]);

  return (
    <main>
      <AppointmentView site={site} categories={categories} token={token} direct />
    </main>
  );
}
