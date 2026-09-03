'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { visibleNav } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { t, type MessageKey } from '@/i18n/tr';
import { cn } from '@/lib/cn';

/**
 * İzne göre süzülmüş gezinme.
 *
 * İzni olmayan öge RENDER EDİLMİYOR — `hidden` sınıfıyla gizlenmiyor. Gizlenmiş
 * bir bağlantı DOM'da durur, ekran okuyucuya okunur ve klavyeyle odaklanabilir;
 * kullanıcıya göremediği bir menüyü "tıklanamaz" olarak sunmak, hiç
 * göstermemekten kötüdür.
 */
export function Sidebar(): ReactNode {
  const { permissions, loading } = useSession();
  const pathname = usePathname();

  if (loading) {
    return <nav aria-busy="true" className="w-56 shrink-0 p-3" />;
  }

  return (
    <nav aria-label="Ana menü" className="w-56 shrink-0 border-r border-line bg-card p-3">
      <ul className="flex flex-col gap-1">
        {visibleNav(permissions).map((item) => {
          const active = pathname === item.path || pathname.startsWith(`${item.path}/`);
          return (
            <li key={item.path}>
              <Link
                href={item.path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm',
                  active ? 'bg-brand-soft font-medium text-ink' : 'text-ink-soft hover:bg-muted',
                )}
              >
                {t(item.labelKey as MessageKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
