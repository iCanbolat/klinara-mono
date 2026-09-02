/**
 * Next data cache etiketleri — TEK üreteç.
 *
 * Aynı dizeyi hem `fetch(..., {next:{tags}})` çağrıları hem de yayın sonrası
 * purge ucu (`/api/revalidate`) kullanıyor. İki yerde elle yazılsaydı bir harf
 * farkı purge'ü sessizce etkisiz kılardı: hata mesajı olmaz, yalnız sayfa
 * beş dakika eski kalırdı.
 */
export const siteTags = {
  all: (slug: string) => `site:${slug}`,
  content: (slug: string) => `site:${slug}:content`,
  catalog: (slug: string) => `site:${slug}:catalog`,
  staff: (slug: string) => `site:${slug}:staff`,
} as const;

export function allSiteTags(slug: string): string[] {
  return [siteTags.all(slug), siteTags.content(slug), siteTags.catalog(slug), siteTags.staff(slug)];
}

/** Slug tag ad alanına giriyor; saldırgan kontrolüne bırakılamaz. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value);
}
