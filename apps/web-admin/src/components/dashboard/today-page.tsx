'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { CalendarCheck, CheckCircle2, Clock, RefreshCw, Sparkles, Wallet } from 'lucide-react';
import { isAppointmentStatus } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/calendar/date';
import { appointmentHref } from '@/lib/calendar/deeplink';
import { occupiesSlot, STATUS_LABEL } from '@/lib/calendar/status';
import { upcomingDayLabel, type UpcomingRow } from '@/lib/dashboard/summary';
import { formatMoney, formatNumber } from '@/lib/reports/format';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { toneClassOf } from '@/components/calendar/appointment-block';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { useDashboard } from './use-dashboard';

/**
 * "Bugünüm" — uygulayıcının karşılama sayfası.
 *
 * Uygulayıcı klinik yöneticisinin sorularını (şubeler, doluluk, personel
 * cirosu) sormuyor; sorusu "bugün kimlere bakıyorum, sıradaki kim, bu ay ne
 * yaptım". Veri `useDashboard`'dan geliyor: sunucu `appointment:read.own`
 * kapsamında takvimi ve performans raporunu zaten KENDİ satırlarına
 * kilitliyor, burada ayrıca süzme yok.
 */

const TODAY_LABEL = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
});

export function TodayPage(): ReactNode {
  const { me } = useSession();
  const state = useDashboard();
  const { today, upcoming, fetchedAt } = state;

  const active = today.filter((row) => occupiesSlot(statusOf(row)));
  const completed = today.filter((row) => statusOf(row) === 'completed').length;
  const next = upcoming[0];
  const own = state.staffPerformance?.data[0];
  const currency = state.staffPerformance?.currency ?? 'TRY';
  const firstName = (me?.user.fullName ?? '').split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        className="mb-0"
        title={t('today.title', { name: firstName })}
        description={`${TODAY_LABEL.format(new Date())} · ${t('today.subtitle')}`}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={state.reload}
            loading={state.loading}
          >
            <RefreshCw aria-hidden="true" />
            {t('common.refresh')}
          </Button>
        }
      />

      <section
        aria-label={t('dashboard.kpis')}
        className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-4 lg:grid-cols-4"
      >
        <StatCard
          label={t('today.kpi.appointments')}
          icon={CalendarCheck}
          loading={state.loading}
          value={formatNumber(active.length)}
          hint={t('today.kpi.appointmentsHint', { completed: formatNumber(completed) })}
        />
        <StatCard
          label={t('today.kpi.next')}
          icon={Clock}
          loading={state.loading}
          value={next === undefined ? '—' : formatTime(next.entry.startsAt, next.timezone)}
          hint={next?.entry.customerName}
        />
        {state.can.staff ? (
          <>
            <StatCard
              label={t('today.kpi.monthServices')}
              icon={CheckCircle2}
              loading={state.loading}
              value={own === undefined ? '—' : formatNumber(own.completedServices)}
            />
            <StatCard
              label={t('today.kpi.monthRevenue')}
              icon={Wallet}
              loading={state.loading}
              value={own === undefined ? '—' : formatMoney(own.revenueMinor, currency)}
            />
          </>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <DayCard
          rows={today}
          fetchedAt={fetchedAt}
          loading={state.loading}
          className="lg:col-span-3"
        />
        <NextCard
          next={next}
          later={upcoming.slice(1, 5)}
          fetchedAt={fetchedAt}
          loading={state.loading}
          className="lg:col-span-2"
        />
      </div>
    </div>
  );
}

function statusOf(row: UpcomingRow) {
  return isAppointmentStatus(row.entry.status) ? row.entry.status : 'scheduled';
}

function useOpen(): (row: UpcomingRow) => void {
  const router = useRouter();
  const { setBranchId } = useBranch();
  return (row) => {
    setBranchId(row.branchId);
    router.push(appointmentHref(row.entry, row.timezone));
  };
}

/** Bugünün akışı — tamamlananlar dahil, saate göre. */
function DayCard({
  rows,
  fetchedAt,
  loading,
  className,
}: {
  rows: readonly UpcomingRow[];
  fetchedAt: number | null;
  loading: boolean;
  className?: string;
}): ReactNode {
  const open = useOpen();
  const multiBranch = new Set(rows.map((row) => row.branchId)).size > 1;

  return (
    <Card className={cn('flex min-h-[360px] flex-col gap-3', className)}>
      <h2 className="text-title-m shrink-0">{t('today.schedule')}</h2>
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
          {t('today.scheduleEmpty')}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {rows.map((row) => {
            const status = statusOf(row);
            const past = fetchedAt !== null && Date.parse(row.entry.endsAt) < fetchedAt;
            const services = row.entry.services.map((line) => line.serviceName).join(', ');
            return (
              <li key={row.entry.id}>
                <button
                  type="button"
                  onClick={() => open(row)}
                  className={cn(
                    'grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1 py-3 text-left transition-colors hover:bg-accent/50',
                    past && 'opacity-60',
                  )}
                >
                  <span className="flex flex-col text-sm tabular-nums">
                    <span className="font-semibold">
                      {formatTime(row.entry.startsAt, row.timezone)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(row.entry.endsAt, row.timezone)}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{row.entry.customerName}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[services, multiBranch ? row.branchName : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'hidden rounded-full border px-2 py-0.5 text-xs font-medium min-[420px]:inline',
                      toneClassOf(status),
                    )}
                  >
                    {t(STATUS_LABEL[status])}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** Sıradaki hasta öne çıkıyor; ardından gelen birkaç randevu altında. */
function NextCard({
  next,
  later,
  fetchedAt,
  loading,
  className,
}: {
  next: UpcomingRow | undefined;
  later: readonly UpcomingRow[];
  fetchedAt: number | null;
  loading: boolean;
  className?: string;
}): ReactNode {
  const open = useOpen();

  return (
    <Card className={cn('flex min-h-[360px] flex-col gap-4', className)}>
      <h2 className="text-title-m shrink-0">{t('today.next')}</h2>
      {loading ? (
        <Skeleton className="h-28 w-full" aria-busy="true" />
      ) : next === undefined ? (
        <p className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
          {t('dashboard.upcomingEmpty')}
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => open(next)}
            className="flex flex-col gap-1 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left transition-colors hover:bg-primary/10"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {fetchedAt === null
                ? null
                : upcomingDayLabel(next.entry.startsAt, next.timezone, fetchedAt)}{' '}
              · {formatTime(next.entry.startsAt, next.timezone)}
            </span>
            <span className="text-title-m">{next.entry.customerName}</span>
            <span className="text-sm text-muted-foreground">
              {next.entry.services.map((line) => line.serviceName).join(', ')}
            </span>
          </button>
          {later.length === 0 ? null : (
            <ul className="flex flex-col divide-y divide-border">
              {later.map((row) => (
                <li key={row.entry.id}>
                  <button
                    type="button"
                    onClick={() => open(row)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-lg px-1 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="min-w-0 truncate font-medium">{row.entry.customerName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fetchedAt === null
                        ? null
                        : upcomingDayLabel(row.entry.startsAt, row.timezone, fetchedAt)}{' '}
                      {formatTime(row.entry.startsAt, row.timezone)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
