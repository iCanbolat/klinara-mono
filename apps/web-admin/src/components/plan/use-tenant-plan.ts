'use client';

import { useEffect, useState } from 'react';
import { PERMISSIONS, type TenantPlanInfo } from '@klinara/shared';
import { useSession } from '@/components/session/session-provider';
import { api } from '@/lib/api/client';

/**
 * Kiracının planı, limitleri ve kullanımı (`GET tenant/plan`).
 *
 * `tenant:read` izni yoksa istek atılmaz ve `null` döner; arayüz bu durumda
 * butonları kapatmaz — son söz zaten sunucunun 409'u.
 * `reloadKey` değişince yeniden çekilir (ör. şube eklendikten sonra).
 */
export function useTenantPlan(reloadKey: unknown = 0): TenantPlanInfo | null {
  const { permissions } = useSession();
  const allowed = permissions.includes(PERMISSIONS.TENANT_READ);
  const [plan, setPlan] = useState<TenantPlanInfo | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    api
      .get<TenantPlanInfo>('tenant/plan', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setPlan(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [allowed, reloadKey]);

  return allowed ? plan : null;
}
