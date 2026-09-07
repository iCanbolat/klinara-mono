'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ScheduleException, StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Field, FieldSelect } from '@/components/ui/field';

/**
 * İzin ve mesai istisnaları.
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
 */
export function ExceptionsPanel({
  branchId,
  staff,
  canWrite,
}: {
  branchId: string;
  staff: readonly StaffProfile[];
  canWrite: boolean;
}): ReactNode {
  const [exceptions, setExceptions] = useState<ScheduleException[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const [staffProfileId, setStaffProfileId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');

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

  async function add(): Promise<void> {
    setBusy('new');
    setError(null);
    try {
      await api.post(
        'schedule-exceptions',
        {
          staffProfileId,
          branchId,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        },
        { branchId },
      );
      toast.success(t('schedule.saved'));
      setStartsAt('');
      setEndsAt('');
      setReason('');
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      await api.delete(`schedule-exceptions/${id}`, { branchId });
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const staffName = (id: string): string =>
    staff.find((profile) => profile.id === id)?.userFullName ?? id;

  const ready = staffProfileId !== '' && startsAt !== '' && endsAt !== '';

  return (
    <div className="flex flex-col gap-4">
      {/* Düzenleme yok — sebebi açıkça yazılı. */}
      <Alert tone="info">{t('schedule.exceptionNoEdit')}</Alert>

      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {canWrite ? (
        <div className="grid items-end gap-2 rounded-lg border border-border p-3 sm:grid-cols-5">
          <FieldSelect
            label={t('schedule.pickStaff')}
            value={staffProfileId}
            disabled={busy !== null}
            onChange={(event) => setStaffProfileId(event.target.value)}
          >
            <option value="">—</option>
            {staff.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.userFullName}
              </option>
            ))}
          </FieldSelect>
          <Field
            label={t('schedule.exceptionFrom')}
            type="datetime-local"
            value={startsAt}
            disabled={busy !== null}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          <Field
            label={t('schedule.exceptionTo')}
            type="datetime-local"
            value={endsAt}
            disabled={busy !== null}
            onChange={(event) => setEndsAt(event.target.value)}
          />
          <Field
            label={t('schedule.exceptionReason')}
            value={reason}
            disabled={busy !== null}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            type="button"
            loading={busy === 'new'}
            disabled={!ready || busy !== null}
            onClick={() => void add()}
          >
            {t('schedule.exceptionAdd')}
          </Button>
        </div>
      ) : null}

      {exceptions !== null && exceptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('schedule.exceptionsEmpty')}</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {(exceptions ?? [])
          .filter((exception) => exception.isActive)
          .map((exception) => (
            <li
              key={exception.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm"
            >
              <span>
                <strong>{staffName(exception.staffProfileId)}</strong>{' '}
                <time dateTime={exception.startsAt} className="tabular-nums">
                  {new Intl.DateTimeFormat('tr-TR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(exception.startsAt))}
                </time>
                {' – '}
                <time dateTime={exception.endsAt} className="tabular-nums">
                  {new Intl.DateTimeFormat('tr-TR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(exception.endsAt))}
                </time>
                {exception.reason === null ? '' : ` · ${exception.reason}`}
              </span>

              {canWrite ? (
                // "Düzenle" YOK — bkz. dosya başlığı.
                <ConfirmButton
                  variant="danger"
                  size="sm"
                  disabled={busy !== null}
                  title={t('schedule.exceptionRemove')}
                  description={staffName(exception.staffProfileId)}
                  onConfirm={() => void remove(exception.id)}
                >
                  {t('schedule.exceptionRemove')}
                </ConfirmButton>
              ) : null}
            </li>
          ))}
      </ul>
    </div>
  );
}
