import type { Service } from '@klinara/shared';

/**
 * Paket tanımı — `GET /package-definitions` yanıtının panelin kullandığı hâli.
 *
 * Tanım SATILMIŞ bir paket değil, bir şablon: satış anında kalemler ve fiyat
 * dondurulur, tanımdaki sonraki değişiklik satılmışları etkilemez.
 */
export interface PackageDefinitionItem {
  id: string;
  serviceId: string;
  serviceName: string;
  quantity: number;
  /** Kalemin GÜNCEL katalog birim fiyatı (kuruş). */
  unitListPriceMinor: number;
  sortOrder: number;
}

export interface PackageDefinition {
  id: string;
  branchId: string | null;
  slug: string;
  name: string;
  description: string | null;
  totalPriceMinor: number;
  /** Kalemlerin güncel katalog toplamı — indirim buradan okunur. */
  listPriceMinor: number;
  currency: string;
  /** `null` = süresiz. */
  validityDays: number | null;
  isTransferable: boolean;
  isOnlineSellable: boolean;
  isActive: boolean;
  version: number;
  items: PackageDefinitionItem[];
}

export interface PackageDefinitionPage {
  data: PackageDefinition[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

/** Sunucunun `ArrayMaxSize(20)` sınırı. */
export const MAX_PACKAGE_ITEMS = 20;
export const MAX_ITEM_QUANTITY = 1000;

/** Formdaki kalem: sunucu yalnız `serviceId` + `quantity` alır. */
export interface PackageItemDraft {
  serviceId: string;
  serviceName: string;
  unitListPriceMinor: number;
  quantity: number;
}

export function totalSessions(items: readonly { quantity: number }[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function listTotalMinor(
  items: readonly { quantity: number; unitListPriceMinor: number }[],
): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitListPriceMinor, 0);
}

/** Pozitif indirim (kuruş) ya da `null` — satış fiyatı listeye eşit/üstündeyse. */
export function discountMinor(listMinor: number, priceMinor: number | null): number | null {
  if (priceMinor === null) return null;
  const diff = listMinor - priceMinor;
  return diff > 0 ? diff : null;
}

/** İndirim yüzdesi, tam sayıya yuvarlanmış; liste toplamı 0 ise `null`. */
export function discountPercent(listMinor: number, priceMinor: number | null): number | null {
  const discount = discountMinor(listMinor, priceMinor);
  if (discount === null || listMinor <= 0) return null;
  return Math.round((discount / listMinor) * 100);
}

/** "10× Lazer, 2× Bakım" — tablo ve kartta kalem özeti. */
export function itemsSummary(items: readonly PackageDefinitionItem[]): string {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => `${String(item.quantity)}× ${item.serviceName}`)
    .join(', ');
}

/**
 * Kalemlerin GÜNCEL katalog fiyatı. Paket kaydındaki `unitListPriceMinor`
 * zaten günceldir; burada formun yeni eklediği kalemler için katalogdan
 * okunuyor. Şube fiyat override'ı paket kapsamı bir şubeye bağlıysa geçerli.
 */
export function servicePriceMinor(service: Service, branchId: string | null): number {
  if (branchId !== null) {
    const override = service.branchOverrides.find((row) => row.branchId === branchId);
    if (override?.priceMinor != null) return override.priceMinor;
  }
  return service.priceMinor;
}

const TR_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

/** "10 Seans Lazer + 2 Bakım" → `10-seans-lazer-2-bakim`. */
export function slugify(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (char) => TR_MAP[char] ?? char)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
