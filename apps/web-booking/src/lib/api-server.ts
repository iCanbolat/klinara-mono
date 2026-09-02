import 'server-only';
import type {
  HostResolution,
  PublicCategory,
  PublicSitePayload,
  StaffOption,
} from '@klinara/shared';
import { serverEnv } from '@/config/env';
import { siteTags } from '@/lib/cache-tags';

/**
 * SUNUCU tarafı okumaları — RSC ve middleware.
 *
 * Buraya yalnız ziyaretçiye ÖZEL OLMAYAN ve cache'lenebilir uçlar giriyor:
 * site içeriği, katalog, şubeler, personel. Uygunluk, tutma, OTP ve self-servis
 * BİLEREK yok — onlar IP bazlı hız sınırına tabi ya da `no-store` ve sunucudan
 * çağrılırlarsa ya tüm ziyaretçiler tek IP'ye çöker ya da bir müşterinin
 * token'ı Next'in data cache'ine düşer.
 */

const SITE_REVALIDATE_SECONDS = 300;

async function get<T>(path: string, init: { tags: string[]; revalidate: number }): Promise<T> {
  const response = await fetch(`${serverEnv.apiInternalUrl}/public/${path}`, {
    headers: { accept: 'application/json' },
    next: { tags: init.tags, revalidate: init.revalidate },
  });
  if (!response.ok) {
    throw new ApiReadError(response.status, path);
  }
  return (await response.json()) as T;
}

export class ApiReadError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`API okuma başarısız: ${status} ${path}`);
    this.name = 'ApiReadError';
  }
}

/** Konak adı → slug. Middleware'in tek API çağrısı. */
export async function resolveHost(host: string): Promise<HostResolution | null> {
  const response = await fetch(
    `${serverEnv.apiInternalUrl}/public/resolve?host=${encodeURIComponent(host)}`,
    {
      headers: { accept: 'application/json' },
      // Konak adı → slug eşlemesi nadiren değişir; API zaten `s-maxage=3600`
      // diyor. Middleware'in kendi LRU'su bunun üstünde duruyor.
      next: { revalidate: 3600 },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiReadError(response.status, 'resolve');
  return (await response.json()) as HostResolution;
}

export function fetchSite(slug: string): Promise<PublicSitePayload> {
  return get<PublicSitePayload>(`sites/${slug}`, {
    tags: [siteTags.all(slug), siteTags.content(slug)],
    revalidate: SITE_REVALIDATE_SECONDS,
  });
}

export function fetchServices(slug: string, branchId?: string): Promise<PublicCategory[]> {
  const query = branchId === undefined ? '' : `?branchId=${encodeURIComponent(branchId)}`;
  return get<PublicCategory[]>(`sites/${slug}/services${query}`, {
    tags: [siteTags.all(slug), siteTags.catalog(slug)],
    revalidate: SITE_REVALIDATE_SECONDS,
  });
}

export function fetchStaff(
  slug: string,
  params: { branchId: string; serviceIds: string[] },
): Promise<StaffOption[]> {
  const query = new URLSearchParams({
    branchId: params.branchId,
    serviceIds: params.serviceIds.join(','),
  });
  return get<StaffOption[]>(`sites/${slug}/staff?${query.toString()}`, {
    tags: [siteTags.all(slug), siteTags.staff(slug)],
    revalidate: SITE_REVALIDATE_SECONDS,
  });
}
