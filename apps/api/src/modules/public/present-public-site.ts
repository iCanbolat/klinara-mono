import type { PublicImage } from '@klinara/shared';
import type { PublicAssetRow, PublicBranchRow, PublicServiceRow } from './public-content.repository';

/**
 * `collectAssetIds` ve `resolveAssets` ARTIK BURADA DEĞİL: `@klinara/shared`te.
 *
 * Yönetim paneli kaydedilmemiş taslağı önizlerken aynı dönüşümü istemcide
 * yapmak zorunda ve ikinci bir kopya, bir gün birinin yeni bir `*AssetId`
 * alanını tanıyıp öbürünün tanımaması demekti — fark tam olarak önizlemenin
 * var olma sebebini çürüterek ortaya çıkardı. Buradan yeniden dışa
 * aktarılıyorlar ki bu modülün çağıranları tek bir yerden okusun.
 */
export { collectAssetIds, resolveAssets } from '@klinara/shared';
export type { PublicImage } from '@klinara/shared';

/**
 * Public yanıtın ALAN BEYAZ LİSTESİ.
 *
 * Burada `select *` yayılımı ya da `...row` yoktur ve olmayacak. Sebep tek bir
 * cümlede: `branches` tablosuna yarın eklenecek bir kolon, bu dosyaya
 * dokunulmadan public bir sayfada belirmemeli. Bir entegrasyon testi dönen
 * anahtarları donmuş bir listeyle karşılaştırıyor.
 */

export interface PublicBranchView {
  id: string;
  name: string;
  timezone: string;
  phone: string | null;
  address: string | null;
}

export interface PublicServiceView {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  /** `showPrices` kapalıyken alan HİÇ YOKTUR — sıfır değil. */
  priceMinor?: number;
  currency?: string;
}

export interface PublicCategoryView {
  id: string;
  name: string;
  services: PublicServiceView[];
}

export function presentBranch(row: PublicBranchRow): PublicBranchView {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    phone: row.phone,
    address: row.address,
  };
}

/**
 * Hizmetleri kategoriye göre gruplar.
 *
 * `showPrices` kapalıyken fiyat alanı ATLANIR, sıfırlanmaz: sıfır göndermek,
 * istemci bugunun "0 TL" yazmasına izin verirdi ve bu bir fiyat beyanı gibi
 * görünürdü.
 */
export function presentCatalog(
  rows: PublicServiceRow[],
  options: { showPrices: boolean; currency: string },
): PublicCategoryView[] {
  const categories = new Map<string, PublicCategoryView>();
  const seen = new Set<string>();

  for (const row of rows) {
    // Aynı hizmet birden çok şubede açık olabilir; public katalog hizmeti bir
    // kez listeler. Şubeye özgü süre/fiyat farkı slot sorgusunda ortaya çıkar.
    const key = `${row.categoryId}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let category = categories.get(row.categoryId);
    if (category === undefined) {
      category = { id: row.categoryId, name: row.categoryName, services: [] };
      categories.set(row.categoryId, category);
    }

    const service: PublicServiceView = {
      id: row.id,
      name: row.name,
      description: row.description,
      durationMinutes: row.durationMinutes,
    };
    if (options.showPrices) {
      service.priceMinor = row.priceMinor;
      service.currency = options.currency;
    }
    category.services.push(service);
  }

  return [...categories.values()];
}

/**
 * İçerik dokümanındaki `assetId` alanlarını URL'e çevirir.
 *
 * Doküman yalnız kimlik taşır; adres SUNUCUDA kurulur. Bulunmayan ya da henüz
 * hazır olmayan bir varlığın alanı `null`a düşer — kırık bir görsel adresi
 * yaymaktansa alanı boş bırakmak daha iyi.
 */
export function buildAssetIndex(
  rows: PublicAssetRow[],
  assetBaseUrl: string,
): Map<string, PublicImage> {
  const index = new Map<string, PublicImage>();
  for (const row of rows) {
    index.set(row.id, {
      url: `${assetBaseUrl.replace(/\/$/, '')}/${row.storageKey}`,
      alt: row.altText,
      width: row.width,
      height: row.height,
    });
  }
  return index;
}
