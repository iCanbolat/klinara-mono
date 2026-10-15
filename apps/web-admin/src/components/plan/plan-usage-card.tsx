'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n/tr';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { useTenantPlan } from './use-tenant-plan';

function Meter({ label, used, limit }: { label: string; used: number; limit: number }): ReactNode {
  const ratio = Math.min(1, used / Math.max(1, limit));
  const full = used >= limit;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className={full ? 'font-medium text-destructive' : 'text-muted-foreground'}>
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={full ? 'h-full bg-destructive' : 'h-full bg-primary'}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** "Plan ve kullanım" — Hesabım sayfasında. İzin yoksa hiç çizilmez. */
export function PlanUsageCard(): ReactNode {
  const plan = useTenantPlan();
  if (plan === null) return null;
  return (
    <Card>
      <CardTitle>{t('plan.title', { name: plan.planName })}</CardTitle>
      <CardDescription>{t('plan.hint')}</CardDescription>
      <div className="flex flex-col gap-4">
        <Meter
          label={t('plan.branches')}
          used={plan.usage.branches}
          limit={plan.limits.maxBranches}
        />
        <Meter
          label={t('plan.practitioners')}
          used={plan.usage.practitioners}
          limit={plan.limits.maxPractitioners}
        />
      </div>
    </Card>
  );
}
