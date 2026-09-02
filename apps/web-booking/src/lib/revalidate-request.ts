import { timingSafeEqual } from 'node:crypto';
import { allSiteTags, isValidSlug } from '@/lib/cache-tags';

export type RevalidateOutcome =
  | { ok: true; tags: string[] }
  | { ok: false; status: 401 | 400 | 503 };

/**
 * Purge isteğinin doğrulanması — saf fonksiyon, bu yüzden test edilebilir.
 *
 * Üç kural:
 *
 * 1. Sır `timingSafeEqual` ile karşılaştırılıyor ve uyuşmazlıkta hangi parçanın
 *    düştüğü SÖYLENMİYOR (`SlotTokenService.verify` gerekçesinin aynısı).
 * 2. Sır yapılandırılmamışsa uç 503 döner, "herkese açık" değil: eksik
 *    yapılandırmanın güvenli yönü kapalı olmaktır.
 * 3. `slug` desene uymak zorunda — tag ad alanı saldırgan kontrolüne geçemez;
 *    `revalidateTag` keyfî bir dize alsaydı başka kiracıların etiketleri
 *    düşürülebilirdi.
 */
export function evaluateRevalidate(input: {
  configuredSecret: string;
  providedSecret: string | null;
  slug: unknown;
  tags?: unknown;
}): RevalidateOutcome {
  if (input.configuredSecret === '') return { ok: false, status: 503 };
  if (!secretMatches(input.configuredSecret, input.providedSecret)) {
    return { ok: false, status: 401 };
  }
  if (!isValidSlug(input.slug)) return { ok: false, status: 400 };

  const all = allSiteTags(input.slug);
  if (input.tags === undefined) return { ok: true, tags: all };
  if (!Array.isArray(input.tags)) return { ok: false, status: 400 };

  // İstenen etiketler yalnız BU slug'ın ad alanından seçilebilir.
  const requested = input.tags.filter((tag): tag is string => typeof tag === 'string');
  const allowed = requested.filter((tag) => all.includes(tag));
  if (allowed.length === 0) return { ok: false, status: 400 };
  return { ok: true, tags: allowed };
}

function secretMatches(expected: string, provided: string | null): boolean {
  if (provided === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
