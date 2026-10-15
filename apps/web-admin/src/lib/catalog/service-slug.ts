import { slugify } from '@/lib/branches/slug';

/** Sunucu kuralı (`CreateServiceDto`): 3–50 karakter, küçük harf/rakam/tire. */
const MIN = 3;
const MAX = 50;

/**
 * Hizmet adından benzersiz hizmet kodu (slug) üretir: `Diş Beyazlatma` → `dis-beyazlatma`.
 *
 * Kod kullanıcıya düzenletilmiyor; bu yüzden çakışma çözümü de burada: aynı kod
 * zaten varsa `-2`, `-3`… eklenir. Çok kısa adlar (`PRP`, `X`) sunucunun alt
 * sınırını tutturmak için `-hizmet` ile uzatılır, harf içermeyen adlar `hizmet`e düşer.
 */
export function serviceSlug(name: string, taken: ReadonlySet<string>): string {
  let base = slugify(name);
  if (base === '') base = 'hizmet';
  if (base.length < MIN) base = `${base}-hizmet`;
  base = base.slice(0, MAX).replace(/-+$/g, '');

  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
