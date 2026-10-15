'use client';

import type { SetupStepKey, TenantStatus } from '@klinara/shared';

/**
 * Platform ekranlarının API çağrısı — `/api/platform/*` (ayrı proxy).
 *
 * Klinik istemcisinin (`lib/api/client.ts`) yenileme ve oturum mantığı burada
 * YOK: platform oturumu tek bir mühürlü cookie, süresi dolunca girişe dönülür.
 */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

export async function platformFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/api/platform/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: 'no-store',
  });
  if (response.status === 401) {
    window.location.assign('/platform/giris');
    throw new PlatformError('Platform oturumu sona erdi', 401, 'UNAUTHENTICATED');
  }
  const text = await response.text();
  const data = text === '' ? null : (JSON.parse(text) as unknown);
  if (!response.ok) {
    const problem = (data ?? {}) as { title?: string; detail?: string; code?: string };
    throw new PlatformError(
      problem.detail ?? problem.title ?? 'İstek başarısız',
      response.status,
      problem.code,
    );
  }
  return data as T;
}

export const STATUS_LABELS: Record<TenantStatus, string> = {
  trial: 'Deneme',
  active: 'Aktif',
  suspended: 'Askıda',
};

export const INVITATION_LABELS = {
  pending: 'Davet bekliyor',
  accepted: 'Sahip katıldı',
  expired: 'Davetin süresi doldu',
  revoked: 'Davet iptal',
} as const;

export const SETUP_LABELS: Record<SetupStepKey, string> = {
  branch: 'Aktif şube',
  hours: 'Çalışma saatleri',
  services: 'Hizmet kataloğu',
  practitioners: 'Hizmet atanmış hekim',
  whatsapp: 'WhatsApp bağlantısı',
  bookingPage: 'Online randevu sayfası yayında',
};
