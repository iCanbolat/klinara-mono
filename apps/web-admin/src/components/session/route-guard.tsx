'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { canOpenPath } from '@/lib/permissions';
import { useSession } from './session-provider';

/**
 * Menüde olmayan bir sayfaya doğrudan URL ile gelen kullanıcıyı karşılama
 * sayfasına geri gönderir.
 *
 * Yetki kapısı DEĞİL (o sunucunun 403'ü); sayfanın `PermissionGate` uyarısı
 * yönlendirme tamamlanana kadar yedek olarak kalıyor.
 */
export function RouteGuard({ children }: { children: ReactNode }): ReactNode {
  const { me, loading, permissions } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const blocked = !loading && me !== null && !canOpenPath(permissions, pathname);

  useEffect(() => {
    if (blocked) router.replace('/dashboard');
  }, [blocked, router]);

  return blocked ? null : children;
}
