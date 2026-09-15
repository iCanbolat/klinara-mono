'use client';

import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { Building2, CalendarCheck, RefreshCw, TrendingUp, UserX, Wallet } from 'lucide-react';
import { PERMISSIONS, isAppointmentStatus, type CalendarEntry } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/calendar/date';
import { STATUS_LABEL } from '@/lib/calendar/status';
import {
  availableBranchMetrics,
  branchChartRows,
  topStaffByRevenue,
} from '@/lib/dashboard/summary';
import { formatDelta, formatMoney, formatNumber, formatPercent } from '@/lib/reports/format';
import { useSession } from '@/components/session/session-provider';
import { useBranch } from '@/components/session/branch-provider';
import { toneClassOf } from '@/components/calendar/appointment-block';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { BranchChart } from './branch-chart';
import { useDashboard } from './use-dashboard';

/**
 * Karşılama sayfası (`/dashboard`).
 *
 * Sıra "önce şimdi, sonra karşılaştırma": resepsiyon sabah paneli açtığında
 * ilk sorusu bugünün yükü ve sıradaki randevu; şube grafiği yöneticinin
 * "şubeler birbirine göre nerede" sorusu, o yüzden en altta. Menü kartları eskiden sayfanın TAMAMIYDI; kenar çubuğuyla birebir
 * aynı listeyi ikinci kez göstermek yer kaplamaktan öteye geçmediği için
 * kaldırıldı.
 *
 * Her bölüm kendi izniyle görünüyor (bkz. `use-dashboard.ts`): muhasebeci
 * takvim bölümlerini, resepsiyon ciro kartını hiç görmüyor.
 */

const TODAY_LABEL = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
});

export function DashboardPage(): ReactNode {
  const { me, loading: sessionLoading, permissions } = useSession();
  const state = useDashboard();
  const { sources, totals, can } = state;

  const ownOnly =
    !permissions.includes(PERMISSIONS.APPOINTMENT_READ_ALL) &&
    permissions.includes(PERMISSIONS.APPOINTMENT_READ_OWN);

  if (sessionLoading) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const kpis: ReactNode[] = [];
  if (can.calendar) {
    kpis.push(
      <StatCard
        key="today"
        label={t('dashboard.kpi.today')}
        icon={CalendarCheck}
        loading={state.loading}
        value={totals.todayTotal === null ? undefined : formatNumber(totals.todayTotal)}
        hint={
          totals.todayActive === null || totals.todayCompleted === null
            ? undefined
            : t('dashboard.kpi.todayHint', {
                active: formatNumber(totals.todayActive),
                completed: formatNumber(totals.todayCompleted),
              })
        }
      />,
    );
  }
  if (can.occupancy) {
    kpis.push(
      <StatCard
        key="occupancy"
        label={t('dashboard.kpi.occupancy')}
        icon={TrendingUp}
        loading={state.loading}
        value={totals.occupancyRate === null ? undefined : formatPercent(totals.occupancyRate)}
        hint={deltaHint(sources.occupancy?.delta?.['occupancyRate'])}
      />,
    );
  }
  if (can.revenue) {
    kpis.push(
      <StatCard
        key="revenue"
        label={t('dashboard.kpi.revenue')}
        icon={Wallet}
        loading={state.loading}
        value={
          totals.revenueMinor === null
            ? undefined
            : formatMoney(totals.revenueMinor, totals.currency ?? 'TRY')
        }
        hint={deltaHint(sources.revenue?.delta?.['accruedMinor'])}
      />,
    );
  }
  if (can.occupancy) {
    kpis.push(
      <StatCard
        key="no-show"
        label={t('dashboard.kpi.noShow')}
        icon={UserX}
        loading={state.loading}
        value={totals.noShowRate === null ? undefined : formatPercent(totals.noShowRate)}
        hint={deltaHint(sources.noShow?.delta?.['noShowRate'])}
      />,
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        className="mb-0"
        title={t('home.greeting', { name: me?.user.fullName ?? '' })}
        description={`${TODAY_LABEL.format(new Date())} · ${t('home.subtitle')}`}
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

      {ownOnly ? <Alert tone="info">{t('calendar.scopeOwn')}</Alert> : null}

      {kpis.length === 0 ? null : (
        <section
          aria-label={t('dashboard.kpis')}
          className={cn(
            'grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-4',
            kpis.length >= 3 && 'lg:grid-cols-4',
          )}
        >
          {kpis}
        </section>
      )}

      {state.errors.calendar !== null || state.errors.reports !== null ? (
        <Alert tone="warn">
          <span role="alert">
            {state.errors.calendar !== null ? t('dashboard.calendarError') : ''}
            {state.errors.calendar !== null && state.errors.reports !== null ? ' ' : ''}
            {state.errors.reports !== null ? t('dashboard.reportsError') : ''}
          </span>
        </Alert>
      ) : null}

      {can.calendar || can.staff ? (
        <div className={cn('grid gap-4', can.calendar && can.staff && 'lg:grid-cols-5')}>
          {can.calendar ? (
            <UpcomingCard state={state} className={can.staff ? 'lg:col-span-3' : undefined} />
          ) : null}
          {can.staff ? (
            <StaffRevenueCard
              state={state}
              className={can.calendar ? 'lg:col-span-2' : undefined}
            />
          ) : null}
        </div>
      ) : null}

      <BranchesSection state={state} />
    </div>
  );
}

function deltaHint(value: number | null | undefined): string | undefined {
  const delta = formatDelta(value);
  return delta === null ? undefined : t('dashboard.kpi.vsPrevious', { delta });
}

type State = ReturnType<typeof useDashboard>;

function BranchesSection({ state }: { state: State }): ReactNode {
  const { loading: branchLoading } = useBranch();
  const rows = useMemo(() => branchChartRows(state.summaries), [state.summaries]);
  const metrics = useMemo(() => availableBranchMetrics(state.summaries), [state.summaries]);

  return (
    <section aria-labelledby="dashboard-branches">
      {state.loading || branchLoading ? (
        <Skeleton className="h-64 rounded-xl" aria-busy="true" />
      ) : state.summaries.length === 0 ? (
        <Card>
          <h2 id="dashboard-branches" className="sr-only">
            {t('dashboard.branches')}
          </h2>
          <EmptyState
            icon={Building2}
            title={t('dashboard.noBranchesTitle')}
            message={t('dashboard.noBranches')}
          />
        </Card>
      ) : (
        <BranchChart rows={rows} metrics={metrics} currency={state.totals.currency ?? 'TRY'} />
      )}
    </section>
  );
}

interface UpcomingRow {
  entry: CalendarEntry;
  branchId: string;
  branchName: string;
  timezone: string;
}

function UpcomingCard({
  state,
  className,
}: {
  state: State;
  className?: string | undefined;
}): ReactNode {
  const router = useRouter();
  const { setBranchId } = useBranch();
  const multiBranch = state.summaries.length > 1;

  // Tüm şubelerin sıradaki randevuları TEK listede: çok şubeli bir klinikte
  // yönetici "sıradaki kim" sorusunu şube şube sormuyor.
  const upcoming = useMemo<UpcomingRow[]>(
    () =>
      state.summaries
        .flatMap((summary) =>
          (summary.today?.upcoming ?? []).map((entry) => ({
            entry,
            branchId: summary.branch.id,
            branchName: summary.branch.name,
            timezone: summary.timezone,
          })),
        )
        .sort((a, b) => Date.parse(a.entry.startsAt) - Date.parse(b.entry.startsAt))
        .slice(0, 8),
    [state.summaries],
  );

  return (
    <Card className={cn('flex flex-col gap-3', className)}>
      <h2 className="text-title-m">{t('dashboard.upcoming')}</h2>
      {state.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-12 w-full" />
          ))}
        </div>
      ) : upcoming.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('dashboard.upcomingEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {upcoming.map((row) => {
            const status = isAppointmentStatus(row.entry.status) ? row.entry.status : 'scheduled';
            const services = row.entry.services.map((line) => line.serviceName).join(', ');
            return (
              <li key={row.entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    setBranchId(row.branchId);
                    router.push('/takvim');
                  }}
                  className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  <span className="text-sm font-semibold tabular-nums">
                    {formatTime(row.entry.startsAt, row.timezone)}
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
        </ul>
      )}
    </Card>
  );
}

/**
 * Bu ayın personel cirosu — en çoktan aza.
 *
 * Şube grafiği "şube ne getirdi"yi zaten söylüyor; buradaki soru "kim
 * getirdi". Çubuk, listenin en yükseğine göre ölçekli: sıralamayı göz ucuyla
 * okutmak için, mutlak bir hedefi temsil etmiyor.
 */
function StaffRevenueCard({
  state,
  className,
}: {
  state: State;
  className?: string | undefined;
}): ReactNode {
  const report = state.staffPerformance;
  const rows = topStaffByRevenue(report);
  const peak = rows[0]?.revenueMinor ?? 0;
  const currency = report?.currency ?? 'TRY';

  return (
    <Card className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-title-m">{t('dashboard.staffRevenue')}</h2>
        <span className="text-xs text-muted-foreground">{t('dashboard.thisMonth')}</span>
      </div>
      {report?.scope === 'own' ? (
        <p className="text-xs text-muted-foreground">{t('dashboard.staffRevenueOwn')}</p>
      ) : null}
      {state.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('dashboard.staffRevenueEmpty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.staffProfileId} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{row.staffName}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatMoney(row.revenueMinor, currency)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${String(peak === 0 ? 0 : Math.round((row.revenueMinor / peak) * 100))}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t('dashboard.staffServices', { count: formatNumber(row.completedServices) })}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
