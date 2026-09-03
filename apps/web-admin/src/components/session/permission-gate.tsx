'use client';

import type { ReactNode } from 'react';
import { can } from '@/lib/permissions';
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
  children,
}: {
  required: readonly string[];
  children: ReactNode;
}): ReactNode {
  const { permissions, loading } = useSession();
  if (loading) return null;
  if (!can(permissions, ...required)) {
    return <Alert tone="warn">{t('error.forbiddenPage')}</Alert>;
  }
  return <>{children}</>;
}
