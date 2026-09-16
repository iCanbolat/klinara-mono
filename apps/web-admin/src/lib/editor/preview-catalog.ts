import type { PublicCategory, Service, ServiceCategorySummary } from '@klinara/shared';

/**
 * Önizlemenin hizmet kataloğu — yönetim uçlarından public şekle.
 *
 * Public `sites/{slug}/services` ucu yalnız YAYINDAKİ site için çalışıyor ve
 * web-booking origin'inde; editör oraya gitmek yerine zaten okuyabildiği
 * `services` + `service-categories` listelerini API'nin `presentCatalog`
 * kuralıyla aynı biçime çeviriyor: yalnız aktif ve online alınabilir hizmetler,
 * kategori sırası korunur, `showPrices=false` iken fiyat anahtarı HİÇ yok.
 */
export function buildPreviewCatalog(
  services: readonly Service[],
  categories: readonly ServiceCategorySummary[],
  options: { showPrices: boolean; currency: string },
): PublicCategory[] {
  const ordered = [...categories]
    .filter((category) => category.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return ordered
    .map((category) => ({
      id: category.id,
      name: category.name,
      services: services
        .filter((s) => s.categoryId === category.id && s.isActive && s.isOnlineBookable)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMinutes: s.durationMinutes,
          ...(options.showPrices ? { priceMinor: s.priceMinor, currency: options.currency } : {}),
        })),
    }))
    .filter((category) => category.services.length > 0);
}
