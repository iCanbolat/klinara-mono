'use client';

import type { ReactNode } from 'react';
import { can, canAny } from '@/lib/permissions';
import { useSession } from './session-provider';
import { Alert } from '@/components/ui/alert';
import { t } from '@/i18n/tr';

/**
 * İzni olmayan kullanıcıya sayfa gövdesi yerine anlaşılır bir panel gösterir.
 *
 * ⚠️ BU BİR GÜVENLİK SINIRI DEĞİL. Kullanıcı bu bileşeni tarayıcıda devre dışı
 * bırakabilir; ama arkasındaki her veri çağrısı proxy'den API'ye gidiyor ve
 * orada `PermissionsGuard` 403 dönüyor. Buradaki kontrolün amacı, kullanıcıya
 * kaydedemeyeceği bir formu hiç göstermemek.
 */
export function PermissionGate({
  required,
  anyOf,
  children,
}: {
  /** Hepsi gerekli (VE). */
  required: readonly string[];
  /**
   * Bunlardan en az biri de gerekli (VEYA).
   *
   * `NAV_ITEMS.requiresAny` ile aynı gerekçe: raporlar ciroyu
   * `report.revenue:read`, doluluğu `appointment:read.all` ile açıyor ve bir
   * rolün ikisine birden sahip olması şart değil.
   */
  anyOf?: readonly string[] | undefined;
  children: ReactNode;
}): ReactNode {
  const { permissions, loading } = useSession();
  if (loading) return null;
  const allowed =
    can(permissions, ...required) && (anyOf === undefined || canAny(permissions, ...anyOf));
  if (!allowed) {
    return <Alert tone="warn">{t('error.forbiddenPage')}</Alert>;
  }
  return <>{children}</>;
}
