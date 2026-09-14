'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarHeart, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Holiday } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { todayKey } from '@/lib/calendar/date';
import { cn } from '@/lib/cn';
import { toMessage } from '@/lib/reports/errors';
import { toHm } from '@/lib/schedule/entries';
import { holidayDateParts, splitHolidays } from '@/lib/schedule/holidays';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { HolidayDialog } from './holiday-dialog';

/**
 * Tatiller ve özel günler.
 *
 * `GET /holidays?branchId=` şube kayıtlarıyla BİRLİKTE kiracı geneli kayıtları
 * da döndürüyor — takvimi etkileyen kümenin tamamı bu. Her kaydın kapsamı bir
 * rozetle gösteriliyor; aynı güne ikisi de varsa şube kaydı geçerli.
 *
 * Kiracı geneli kaydı yalnız kiracı kapsamlı roller değiştirebiliyor (bkz.
 * `holiday-dialog.tsx`); şube yöneticisine o satırlarda eylem gösterilmiyor.
 */
export function HolidaysPanel({
  branchId,
  timeZone,
  canWrite,
  canWriteTenant,
}: {
  branchId: string;
  timeZone: string;
  canWrite: boolean;
  canWriteTenant: boolean;
}): ReactNode {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [creating, setCreating] = useState(false);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const result = await api.get<{ data: Holiday[] }>(`holidays?branchId=${branchId}`, {
          signal: controller.signal,
          branchId,
        });
        if (controller.signal.aborted) return;
        setHolidays(result.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [branchId, nonce]);

  async function remove(holiday: Holiday): Promise<void> {
    setBusy(holiday.id);
    setError(null);
    try {
      await api.delete(`holidays/${holiday.id}`, { branchId });
      toast.success(t('schedule.holidayRemoved'));
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const { upcoming, past } = useMemo(
    () => splitHolidays(holidays ?? [], todayKey(timeZone)),
    [holidays, timeZone],
  );

  const renderItem = (holiday: Holiday): ReactNode => {
    const parts = holidayDateParts(holiday.holidayDate);
    const tenantWide = holiday.branchId === null;
    const editable = canWrite && (!tenantWide || canWriteTenant);

    return (
      <li
        key={holiday.id}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:p-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <time
            dateTime={holiday.holidayDate}
            className="flex w-14 shrink-0 flex-col items-center rounded-lg border border-border bg-background py-1.5 leading-none"
          >
            <span className="text-[0.6875rem] font-semibold text-primary uppercase">{parts.month}</span>
            <span className="mt-1 text-xl font-semibold tabular-nums">{parts.day}</span>
          </time>
          <div className="min-w-0">
            <p className="truncate text-body-emphasis">{holiday.name}</p>
            <p className="text-sm text-muted-foreground">
              {parts.weekday} · {parts.year}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant={holiday.isClosed ? 'secondary' : 'outline'}>
                {holiday.isClosed
                  ? t('schedule.closed')
                  : t('schedule.holidayHalfDayHours', {
                      open: toHm(holiday.openTime) ?? '',
                      close: toHm(holiday.closeTime) ?? '',
                    })}
              </Badge>
              <Badge variant="outline" className={cn(tenantWide && 'border-primary/40 text-primary')}>
                {tenantWide ? t('schedule.holidayScopeTenant') : t('schedule.holidayScopeBranch')}
              </Badge>
            </div>
          </div>
        </div>

        {editable ? (
          <div className="flex shrink-0 justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setEditing(holiday)}
            >
              <Pencil aria-hidden="true" />
              {t('catalog.edit')}
            </Button>
            <ConfirmButton
              variant="ghost"
              size="sm"
              destructive
              disabled={busy !== null}
              loading={busy === holiday.id}
              title={t('schedule.holidayRemoveTitle')}
              description={`${holiday.name} · ${parts.day} ${parts.month} ${parts.year}`}
              confirmLabel={t('schedule.holidayRemove')}
              onConfirm={() => void remove(holiday)}
            >
              {t('schedule.holidayRemove')}
            </ConfirmButton>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t('schedule.holidayOverrideHint')}</p>
        {canWrite ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t('schedule.holidayAdd')}
          </Button>
        ) : null}
      </div>

      {canWrite && !canWriteTenant && (holidays ?? []).some((holiday) => holiday.branchId === null) ? (
        <p className="text-xs text-muted-foreground">{t('schedule.holidayTenantReadOnly')}</p>
      ) : null}

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {holidays === null && error === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : null}

      {holidays !== null && holidays.length === 0 ? (
        <EmptyState
          icon={CalendarHeart}
          title={t('schedule.holidaysEmpty')}
          message={t('schedule.holidaysEmptyHint')}
        />
      ) : null}

      {upcoming.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-label text-muted-foreground">{t('schedule.holidaysUpcoming')}</h3>
          <ul className="grid gap-2 lg:grid-cols-2">{upcoming.map(renderItem)}</ul>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="flex flex-col gap-2">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="self-start px-0"
            aria-expanded={showPast}
            onClick={() => setShowPast((value) => !value)}
          >
            {showPast ? t('schedule.hidePast') : t('schedule.showPast', { count: past.length })}
          </Button>
          {showPast ? (
            <ul className="grid gap-2 opacity-80 lg:grid-cols-2">{past.map(renderItem)}</ul>
          ) : null}
        </section>
      ) : null}

      {canWrite ? (
        <HolidayDialog
          open={creating || editing !== null}
          holiday={editing}
          branchId={branchId}
          canWriteTenant={canWriteTenant}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            setNonce((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}
