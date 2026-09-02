import type { PublicAssetRow, PublicBranchRow, PublicServiceRow } from './public-content.repository';

/**
 * Public yanıtın ALAN BEYAZ LİSTESİ.
 *
 * Burada `select *` yayılımı ya da `...row` yoktur ve olmayacak. Sebep tek bir
 * cümlede: `branches` tablosuna yarın eklenecek bir kolon, bu dosyaya
 * dokunulmadan public bir sayfada belirmemeli. Bir entegrasyon testi dönen
 * anahtarları donmuş bir listeyle karşılaştırıyor.
 */

export interface PublicImage {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

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

/** İçerik dokümanında geçen tüm `assetId` alanlarını toplar. */
export function collectAssetIds(document: {
  theme: Record<string, unknown>;
  sections: unknown[];
  seo: Record<string, unknown>;
}): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'string' && /AssetId$|^assetId$/.test(key)) ids.add(entry);
      else visit(entry);
    }
  };
  visit(document.theme);
  visit(document.sections);
  visit(document.seo);
  return [...ids];
}

/**
 * Dokümandaki `assetId` alanlarını çözülmüş görsellerle DEĞİŞTİRİR.
 *
 * İstemci `logoAssetId` görüp ikinci bir istek atmak zorunda kalmasın; sayfa
 * tek çağrıda render edilebilmeli.
 */
export function resolveAssets(value: unknown, index: Map<string, PublicImage>): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveAssets(item, index));
  if (value === null || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && /AssetId$|^assetId$/.test(key)) {
      const field = key === 'assetId' ? 'image' : key.replace(/AssetId$/, '');
      result[field] = index.get(entry) ?? null;
      continue;
    }
    result[key] = resolveAssets(entry, index);
  }
  return result;
}
