'use client';

import Link from 'next/link';
import { ArrowRight, BarChart3, FileText, Globe, LayoutPanelTop, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { visibleNav } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n/tr';

const ICONS: Record<string, LucideIcon> = {
  '/sayfa': LayoutPanelTop,
  '/icerik': FileText,
  '/alan-adlari': Globe,
  '/raporlar': BarChart3,
};

export default function DashboardPage(): ReactNode {
  const { me, loading, permissions } = useSession();

  if (loading) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // `/hesap` dışarıda: hesap zaten üst çubuktaki kullanıcı menüsünde ve panelin
  // giriş kartlarından biri olması onu bir "iş" gibi gösterirdi.
  const cards = visibleNav(permissions).filter((item) => item.path !== '/hesap');

  return (
    <>
      <PageHeader
        title={t('home.greeting', { name: me?.user.fullName ?? '' })}
        description={t('home.subtitle')}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((item) => {
          const Icon = ICONS[item.path];
          const descKey = `home.desc.${item.path}` as MessageKey;
          return (
            <Link
              key={item.path}
              href={item.path}
              className="group rounded-xl transition-colors"
            >
              <Card className="h-full transition-colors group-hover:border-primary/45 group-hover:bg-accent/30">
                <div className="mb-3 flex items-center justify-between">
                  {Icon === undefined ? null : (
                    <Icon aria-hidden="true" className="size-5 text-primary" />
                  )}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </div>
                <CardTitle>{t(item.labelKey as MessageKey)}</CardTitle>
                <CardDescription>{t(descKey)}</CardDescription>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
