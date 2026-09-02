import { AppointmentView } from '@/components/selfservice/appointment-view';
import { fetchServices, fetchSite } from '@/lib/api-server';

/**
 * Self-servis sayfası.
 *
 * `force-dynamic`: bu sayfa asla cache'lenmemeli. Token URL'de ve tek bir
 * randevuya erişim veriyor; statik bir kopya, bağlantıyı bilmeyene de
 * gösterilebilir hâle gelirdi. Randevunun kendisi İSTEMCİDEN çekiliyor —
 * token sunucu tarafında istenirse Next'in data cache'ine ve sunucu loguna
 * düşerdi.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function SelfServicePage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const [site, categories] = await Promise.all([fetchSite(slug), fetchServices(slug)]);

  return (
    <main>
      <AppointmentView site={site} categories={categories} token={token} />
    </main>
  );
}
