'use client';

import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  CircleDollarSign,
  Repeat,
  UserRoundX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PERMISSIONS } from '@klinara/shared';
import { useSession } from '@/components/session/session-provider';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { t, type MessageKey } from '@/i18n/tr';
import { canAny } from '@/lib/permissions';

/**
 * Rapor hub'ı.
 *
 * Kartlar İZNE GÖRE süzülüyor ve süzme `canAny`: ciroyu `report.revenue:read`,
 * doluluk ve gelmeme raporlarını `appointment:read.all` açıyor. Muhasebeci
 * (takvim izni yok) ile resepsiyon (ciro izni yok) bu sayfada farklı kart
 * kümeleri görüyor — ve göremediği kart RENDER EDİLMİYOR, gizlenmiyor.
 */

interface ReportCard {
  slug: string;
  icon: LucideIcon;
  titleKey: MessageKey;
  hintKey: MessageKey;
  /** Bunlardan en az biri. */
  anyOf: readonly string[];
}

const CARDS: readonly ReportCard[] = [
  {
    slug: 'doluluk',
    icon: CalendarClock,
    titleKey: 'reports.occupancy',
    hintKey: 'reports.occupancyHint',
    anyOf: [PERMISSIONS.APPOINTMENT_READ_ALL, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN],
  },
  {
    slug: 'ciro',
    icon: CircleDollarSign,
    titleKey: 'reports.revenue',
    hintKey: 'reports.revenueHint',
    anyOf: [PERMISSIONS.REPORT_REVENUE_READ],
  },
  {
    slug: 'personel',
    icon: Users,
    titleKey: 'reports.staffPerformance',
    hintKey: 'reports.staffPerformanceHint',
    anyOf: [PERMISSIONS.REPORT_REVENUE_READ, PERMISSIONS.REPORT_PERFORMANCE_READ_OWN],
  },
  {
    slug: 'gelmeme',
    icon: UserRoundX,
    titleKey: 'reports.noShow',
    hintKey: 'reports.noShowHint',
    anyOf: [PERMISSIONS.APPOINTMENT_READ_ALL],
  },
  {
    slug: 'kazanim',
    icon: Repeat,
    titleKey: 'reports.retention',
    hintKey: 'reports.retentionHint',
    anyOf: [PERMISSIONS.APPOINTMENT_READ_ALL],
  },
];

export default function Page(): ReactNode {
  const { permissions, loading } = useSession();
  if (loading) return null;

  const visible = CARDS.filter((card) => canAny(permissions, ...card.anyOf));

  return (
    <section>
      <PageHeader title={t('reports.title')} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((card) => (
          <Link key={card.slug} href={`/raporlar/${card.slug}`} className="group block rounded-xl">
            <Card className="h-full transition-colors group-hover:border-primary/45 group-hover:bg-accent/30">
              <div className="mb-3 flex items-center justify-between">
                <card.icon aria-hidden="true" className="size-5 text-primary" />
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </div>
              <CardTitle>{t(card.titleKey)}</CardTitle>
              <CardDescription>{t(card.hintKey)}</CardDescription>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
