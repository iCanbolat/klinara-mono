'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, MapPin, Phone } from 'lucide-react';
import { t } from '@/i18n/tr';
import { useBranch } from '@/components/session/branch-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatTime } from '@/lib/calendar/date';
import type { BranchSummary } from '@/lib/dashboard/summary';
import { formatMoney, formatNumber, formatPercent } from '@/lib/reports/format';

/**
 * Şube kartı — bugünün sayıları üstte, ayın oranları altta.
 *
 * Bilinmeyen değer (`null`: izin yok ya da kaynak düştü) satırı GİZLİYOR,
 * "—" basmıyor; ciro izni olmayan resepsiyonun her kartta boş bir "Ciro —"
 * satırı görmesi, ona eksik bir şey varmış gibi okunurdu. Bugün bölümü ise
 * takvim izni varken hata olsa da duruyor ki kart boyu şubeden şubeye
 * zıplamasın.
 */
export function BranchCard({
  summary,
  showToday,
}: {
  summary: BranchSummary;
  showToday: boolean;
}): ReactNode {
  const router = useRouter();
  const { setBranchId } = useBranch();
  const { branch, today, timezone } = summary;
  const next = today?.upcoming[0];

  const month: { label: string; value: string }[] = [];
  if (summary.occupancyRate !== null) {
    month.push({
      label: t('dashboard.branch.occupancy'),
      value: formatPercent(summary.occupancyRate),
    });
  }
  if (summary.revenueMinor !== null) {
    month.push({
      label: t('dashboard.branch.revenue'),
      value: formatMoney(summary.revenueMinor, summary.currency ?? 'TRY'),
    });
  }
  if (summary.noShowRate !== null) {
    month.push({ label: t('dashboard.branch.noShow'), value: formatPercent(summary.noShowRate) });
  }

  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-title-m text-foreground">{branch.name}</h3>
        {branch.address ? (
          <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="line-clamp-2">{branch.address}</span>
          </span>
        ) : null}
        {branch.phone ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone aria-hidden="true" className="size-3.5 shrink-0" />
            <a href={`tel:${branch.phone}`} className="hover:underline">
              {branch.phone}
            </a>
          </span>
        ) : null}
      </div>

      {showToday ? (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3">
          <span className="text-label text-muted-foreground">{t('dashboard.branch.today')}</span>
          {today === null ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <>
              <span className="flex items-baseline gap-2">
                <span className="text-display-m tabular-nums">{formatNumber(today.total)}</span>
                <span className="text-sm text-muted-foreground">
                  {t('dashboard.kpi.todayHint', {
                    active: formatNumber(today.active),
                    completed: formatNumber(today.completed),
                  })}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {next === undefined
                  ? t('dashboard.branch.noNext')
                  : t('dashboard.branch.next', {
                      time: formatTime(next.startsAt, timezone),
                      name: next.customerName,
                    })}
              </span>
            </>
          )}
        </div>
      ) : null}

      {month.length === 0 ? null : (
        <dl className="grid grid-cols-3 gap-2">
          {month.map((item) => (
            <div key={item.label} className="flex min-w-0 flex-col">
              <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
              <dd className="truncate text-sm font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {showToday ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-auto self-start"
          onClick={() => {
            setBranchId(branch.id);
            router.push('/takvim');
          }}
        >
          {t('dashboard.branch.openCalendar')}
          <ArrowRight aria-hidden="true" />
        </Button>
      ) : null}
    </Card>
  );
}
