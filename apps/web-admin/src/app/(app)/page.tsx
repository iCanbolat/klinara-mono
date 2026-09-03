'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { visibleNav } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { Card, CardTitle } from '@/components/ui/card';
import { t, type MessageKey } from '@/i18n/tr';

export default function DashboardPage(): ReactNode {
  const { me, loading, permissions } = useSession();
  if (loading) return <p className="text-sm text-ink-soft">{t('common.loading')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">
        {me?.user.fullName ?? ''}
      </h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleNav(permissions)
          .filter((item) => item.path !== '/hesap')
          .map((item) => (
            <Link key={item.path} href={item.path}>
              <Card className="hover:border-line-strong">
                <CardTitle>{t(item.labelKey as MessageKey)}</CardTitle>
              </Card>
            </Link>
          ))}
      </div>
    </div>
  );
}
