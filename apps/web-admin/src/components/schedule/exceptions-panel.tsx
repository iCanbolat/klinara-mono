'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarOff, Plus, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import type { ScheduleException, StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { describeException, isOngoing, isPast } from '@/lib/schedule/exceptions';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldSelect } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { ExceptionDialog } from './exception-dialog';

/**
 * İzinler.
 *
 * ---------------------------------------------------------------------------
 * "DÜZENLE" DÜĞMESİ YOK VE OLMAYACAK
 * ---------------------------------------------------------------------------
 * Sunucuda `PATCH /schedule-exceptions/:id` UCU YOK: yalnız oluşturma ve
 * (pasife alan) silme var.
 *
 * Sahte bir "düzenle" düğmesi koyup arkada sil + yeniden yarat yapmak
 * cazip ama YANLIŞ: iki çağrının arasında ağ koparsa istisna YOK OLUR ve
 * personel o gün çalışıyor görünür — yani izinli birine randevu yazılır.
 * Arayüz iki ayrı eylem gösteriyor ve kullanıcı sırayı kendi biliyor.
 *
 * Liste "süren ve yaklaşan" önce; geçmiş kayıtlar katlanmış. Resepsiyonun
 * sorusu "bu hafta kim yok", geçen ayın izinleri değil.
 */
export function ExceptionsPanel({
  branchId,
  timeZone,
  staff,
  canWrite,
}: {
  branchId: string;
  timeZone: string;
  staff: readonly StaffProfile[];
  canWrite: boolean;
}): ReactNode {
  const [exceptions, setExceptions] = useState<ScheduleException[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const [staffFilter, setStaffFilter] = useState('');
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        // ⚠️ Sorgu parametresi VE `X-Branch-Id` başlığı — ikisi de gerekli.
        const result = await api.get<{ data: ScheduleException[] }>(
          `schedule-exceptions?branchId=${branchId}`,
          { signal: controller.signal, branchId },
        );
        if (controller.signal.aborted) return;
        setExceptions(result.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [branchId, nonce]);

  async function remove(id: string): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      await api.delete(`schedule-exceptions/${id}`, { branchId });
      toast.success(t('schedule.exceptionRemoved'));
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const staffById = useMemo(() => new Map(staff.map((profile) => [profile.id, profile])), [staff]);

  const { current, past } = useMemo(() => {
    const now = new Date();
    const active = (exceptions ?? []).filter(
      (exception) =>
        exception.isActive && (staffFilter === '' || exception.staffProfileId === staffFilter),
    );
    const byStart = (a: ScheduleException, b: ScheduleException): number =>
      a.startsAt.localeCompare(b.startsAt);
    return {
      current: active.filter((exception) => !isPast(exception, now)).sort(byStart),
      past: active.filter((exception) => isPast(exception, now)).sort((a, b) => byStart(b, a)),
    };
  }, [exceptions, staffFilter]);

  const renderItem = (exception: ScheduleException): ReactNode => {
    const profile = staffById.get(exception.staffProfileId);
    const name = profile?.userFullName ?? '—';
    const summary = describeException(exception, timeZone);
    return (
      <li
        key={exception.id}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
          >
            {initials(name)}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-body-emphasis">{name}</span>
              {isOngoing(exception, new Date()) ? (
                <Badge variant="secondary">{t('schedule.exceptionOngoing')}</Badge>
              ) : null}
              {exception.recurrenceType === 'weekly' ? (
                <Badge variant="outline" className="gap-1">
                  <Repeat aria-hidden="true" />
                  {t('schedule.exceptionRecurring')}
                </Badge>
              ) : null}
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">{summary}</p>
            {exception.reason === null ? null : (
              <p className="mt-0.5 text-sm">{exception.reason}</p>
            )}
          </div>
        </div>

        {canWrite ? (
          // "Düzenle" YOK — bkz. dosya başlığı.
          <ConfirmButton
            variant="ghost"
            size="sm"
            destructive
            className="self-end sm:self-center"
            disabled={busy !== null}
            loading={busy === exception.id}
            title={t('schedule.exceptionRemoveTitle')}
            description={`${name} · ${summary}`}
            confirmLabel={t('schedule.exceptionRemove')}
            onConfirm={() => void remove(exception.id)}
          >
            {t('schedule.exceptionRemove')}
          </ConfirmButton>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <FieldSelect
          label={t('schedule.allStaff')}
          className="w-full sm:max-w-xs"
          value={staffFilter}
          onChange={(event) => setStaffFilter(event.target.value)}
        >
          <option value="">{t('schedule.allStaff')}</option>
          {staff.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.userFullName}
            </option>
          ))}
        </FieldSelect>
        {canWrite ? (
          <Button type="button" disabled={staff.length === 0} onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t('schedule.exceptionAdd')}
          </Button>
        ) : null}
      </div>

      {canWrite ? <p className="text-xs text-muted-foreground">{t('schedule.exceptionNoEdit')}</p> : null}

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {exceptions === null && error === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : null}

      {exceptions !== null && current.length === 0 && past.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title={t('schedule.exceptionsEmpty')}
          message={t('schedule.exceptionsEmptyHint')}
        />
      ) : null}

      {current.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-label text-muted-foreground">{t('schedule.exceptionsUpcoming')}</h3>
          <ul className="flex flex-col gap-2">{current.map(renderItem)}</ul>
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
          {showPast ? <ul className="flex flex-col gap-2 opacity-80">{past.map(renderItem)}</ul> : null}
        </section>
      ) : null}

      {canWrite ? (
        <ExceptionDialog
          open={creating}
          branchId={branchId}
          timeZone={timeZone}
          staff={staff}
          defaultStaffProfileId={staffFilter}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setNonce((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr'))
    .join('');
}
