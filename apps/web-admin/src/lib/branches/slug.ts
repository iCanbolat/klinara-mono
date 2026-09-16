/**
 * Şube adından şube kodu (slug) türetir: `İzmir Alsancak` → `izmir-alsancak`.
 *
 * Sunucunun kuralı (`CreateBranchDto`): 3–50 karakter, küçük harf/rakam/tire.
 * Türetilen değer yalnız bir ÖNERİ — alan düzenlenebilir ve doğrulamanın
 * otoritesi sunucu.
 */
const TURKISH: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i̇: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

export function slugify(name: string): string {
  return name
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]|i̇/g, (char) => TURKISH[char] ?? char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

const FALLBACK_TIME_ZONES = ['Europe/Istanbul', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai'];

/** Seçilebilir saat dilimleri; `Europe/Istanbul` başta. */
export function timeZoneOptions(current?: string): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = FALLBACK_TIME_ZONES;
  }
  const set = new Set(['Europe/Istanbul', ...(current === undefined ? [] : [current]), ...zones]);
  return [...set];
}
