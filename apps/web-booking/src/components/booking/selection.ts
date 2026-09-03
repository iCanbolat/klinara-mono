import type { PublicCategory, PublicService, PublicSitePayload } from '@klinara/shared';
import { ALL_STEPS, type BookingState } from './machine';

/**
 * Ekranın her yerinde gösterilen "ne seçildi" modeli.
 *
 * Özet paneli ve onay adımı AYNI türetmeyi kullanıyor: iki yerde ayrı ayrı
 * hesaplansaydı, `showPrices` kapalıyken birinde fiyatın kalması an meselesi
 * olurdu.
 */
export interface SelectionSummary {
  branchName: string | null;
  branchAddress: string | null;
  timezone: string;
  services: PublicService[];
  /** `staffRef` seçili ve adı biliniyorsa ad; "fark etmez" ise `null`. */
  staffName: string | null;
  /**
   * Kullanıcı uygulayıcı adımında bir KARAR verdi mi.
   *
   * "Fark etmez" geçerli bir seçim ama HENÜZ o adıma gelmemiş birine özet
   * panelinde "Fark etmez" yazmak, yapmadığı bir tercihi ona atfetmek olurdu.
   */
  staffDecided: boolean;
  startsAt: string | null;
  totalMinutes: number;
  /** `showPrices` kapalıysa ya da bir hizmetin fiyatı yoksa `null`. */
  totalMinor: number | null;
  currency: string;
}

export function buildSelection(
  site: PublicSitePayload,
  categories: PublicCategory[],
  state: BookingState,
  staffName: string | null,
): SelectionSummary {
  const branch = site.branches.find((item) => item.id === state.branchId) ?? null;
  const all = categories.flatMap((category) => category.services);
  // Sıra ANLAMLI: uygunluk ucu hizmetleri seçildikleri sırayla zincirliyor.
  const services = state.serviceIds
    .map((id) => all.find((service) => service.id === id))
    .filter((service): service is PublicService => service !== undefined);

  const totalMinutes = services.reduce((sum, service) => sum + service.durationMinutes, 0);

  // Fiyat düğümü `showPrices` kapalıyken HİÇ üretilmiyor — sunucu anahtarı
  // zaten göndermiyor, istemci de "0 TL" yazamasın.
  const priced = site.settings.showPrices && services.every((s) => s.priceMinor !== undefined);
  const totalMinor = priced
    ? services.reduce((sum, service) => sum + (service.priceMinor ?? 0), 0)
    : null;

  // `>=`: uygulayıcı adımı AÇIKKEN kartlarda "Fark etmez" zaten seçili
  // görünüyor; özet panelinin aynı anda "Seçilmedi" demesi iki farklı gerçek
  // anlatmak olurdu.
  const atOrPastStaffStep = ALL_STEPS.indexOf(state.step) >= ALL_STEPS.indexOf('staff');

  return {
    branchName: branch?.name ?? null,
    branchAddress: branch?.address ?? null,
    timezone: branch?.timezone ?? site.timezone,
    services,
    staffName,
    staffDecided: state.staffRef !== null || atOrPastStaffStep,
    startsAt: state.hold?.startsAt ?? null,
    totalMinutes,
    totalMinor,
    currency: services[0]?.currency ?? site.currency,
  };
}
