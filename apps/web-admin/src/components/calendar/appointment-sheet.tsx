'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  isAppointmentStatus,
  type Appointment,
  type AppointmentHistoryEntry,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FieldTextarea } from '@/components/ui/field';
import { formatTime } from '@/lib/calendar/date';
import { STATUS_LABEL, statusActions } from '@/lib/calendar/status';
import { CancelDialog } from './cancel-dialog';
import { RescheduleDialog } from './reschedule-dialog';

/**
 * Randevu ayrıntısı — durum zinciri, not, geçmiş.
 *
 * ---------------------------------------------------------------------------
 * HER MUTASYONDAN SONRA YENİDEN OKUMA — TERCİH DEĞİL ZORUNLULUK
 * ---------------------------------------------------------------------------
 * `POST /appointments/:id/cancel` ve `/status` kaydı değiştirip `version`ı
 * artırıyor ama **ETag DÖNMÜYOR ve If-Match İSTEMİYOR** (sunucu tarafında
 * bilinen bir asimetri; planda A2 olarak işaretli). Yani bu iki çağrıdan
 * sonra istemcinin elindeki sürüm SESSİZCE BAYATLIYOR.
 *
 * Telafi: bu iki çağrının ardından randevu her zaman `GET /appointments/:id`
 * ile yeniden okunuyor. Okunmasaydı, kullanıcı kendi yaptığı iptalden hemen
 * sonra notu düzenlemeye kalktığında **kendi işleminden dolayı** 409
 * `VERSION_CONFLICT` yerdi — anlaşılması imkânsız bir hata.
 *
 * `test/dom/appointment-sheet.test.tsx` bu yeniden okumayı çağrı sayısıyla
 * sabitliyor; A2 sunucuda kapatılırsa telafi kaldırılabilir ama o zamana
 * kadar regresyon kilidi burada.
 */
export function AppointmentSheet({
  appointmentId,
  timezone,
  onClose,
  onChanged,
}: {
  appointmentId: string | null;
  timezone: string;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const { permissions } = useSession();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [history, setHistory] = useState<AppointmentHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (appointmentId === null) return;

    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const result = await api.get<Appointment>(`appointments/${appointmentId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setAppointment(result);
        setNotes(result.notes ?? '');

        const historyResult = await api.get<{ data: AppointmentHistoryEntry[] }>(
          `appointments/${appointmentId}/history`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setHistory(historyResult.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();

    return () => controller.abort();
  }, [appointmentId, nonce]);

  /** Yeniden okumayı tetikler; yukarıdaki A2 telafisi buradan geçiyor. */
  function refetch(): void {
    setNonce((value) => value + 1);
    onChanged();
  }

  async function changeStatus(to: string): Promise<void> {
    if (appointment === null) return;
    setBusy(to);
    setError(null);
    try {
      await api.post(`appointments/${appointment.id}/status`, { status: to });
      toast.success(t('calendar.updated'));
      // ⚠️ ETag DÖNMÜYOR — yeniden okumak ZORUNLU.
      refetch();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveNotes(): Promise<void> {
    if (appointment === null) return;
    setBusy('notes');
    setError(null);
    try {
      // `PATCH` `If-Match` ZORUNLU tutuyor: başlıksız istek 428 döner.
      // Kullanıcı 428 görmemeli — o bir istemci hatasıdır.
      const updated = await api.patch<Appointment>(
        `appointments/${appointment.id}`,
        { notes: notes.trim() === '' ? null : notes.trim() },
        { ifMatch: `W/"${String(appointment.version)}"` },
      );
      setAppointment(updated);
      toast.success(t('calendar.updated'));
      onChanged();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const status =
    appointment !== null && isAppointmentStatus(appointment.status)
      ? appointment.status
      : 'scheduled';
  const actions = appointment === null ? [] : statusActions(status, permissions);

  return (
    <>
      <Sheet open={appointmentId !== null} onOpenChange={(next) => !next && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('calendar.detail.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('calendar.detail.title')}</SheetDescription>
          </SheetHeader>

          {error !== null ? (
            <Alert tone="danger" className="mx-4">
              <span role="alert">{error}</span>
            </Alert>
          ) : null}

          {appointment === null ? (
            <p className="p-4 text-sm text-muted-foreground" aria-busy="true">
              {t('calendar.loading')}
            </p>
          ) : (
            <div className="flex flex-col gap-5 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-title-m tabular-nums">
                  {formatTime(appointment.startsAt, timezone)} –{' '}
                  {formatTime(appointment.endsAt, timezone)}
                </span>
                <Badge>{t(STATUS_LABEL[status])}</Badge>
              </div>

              <section>
                <h3 className="text-label mb-1">{t('calendar.detail.services')}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {appointment.services.map((line) => (
                    <li key={line.id} className="flex justify-between gap-2">
                      <span className="truncate">{line.serviceId}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {line.durationMinutes} dk
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {actions.length > 0 ? (
                <section>
                  <h3 className="text-label mb-2">{t('calendar.detail.title')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {actions.map((action) => (
                      <Button
                        key={action.to}
                        type="button"
                        variant="secondary"
                        size="sm"
                        // İzinsiz geçiş GÖSTERİLİYOR ama etkisiz: hiç
                        // göstermemek "böyle bir şey yapılamaz" derdi.
                        disabled={!action.allowed || busy !== null}
                        loading={busy === action.to}
                        title={action.reasonKey === undefined ? undefined : t(action.reasonKey)}
                        onClick={() => void changeStatus(action.to)}
                      >
                        {t(action.labelKey)}
                      </Button>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setRescheduling(true)}
                >
                  {t('calendar.action.reschedule')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setCancelling(true)}
                >
                  {t('calendar.action.cancel')}
                </Button>
              </div>

              <section className="flex flex-col gap-2">
                <FieldTextarea
                  label={t('calendar.detail.notes')}
                  rows={3}
                  value={notes}
                  disabled={busy !== null}
                  onChange={(event) => setNotes(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  className="self-start"
                  loading={busy === 'notes'}
                  disabled={busy !== null}
                  onClick={() => void saveNotes()}
                >
                  {t('calendar.detail.saveNotes')}
                </Button>
              </section>

              <section>
                <h3 className="text-label mb-1">{t('calendar.detail.history')}</h3>
                <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {(history ?? []).map((entry) => (
                    <li key={entry.id}>
                      {formatTime(entry.createdAt, timezone)} · {entry.action}
                      {entry.toStatus === null ? '' : ` → ${entry.toStatus}`}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {appointment !== null ? (
        <>
          <RescheduleDialog
            open={rescheduling}
            appointment={appointment}
            timezone={timezone}
            onClose={() => setRescheduling(false)}
            onDone={() => {
              setRescheduling(false);
              refetch();
            }}
          />
          <CancelDialog
            open={cancelling}
            appointment={appointment}
            onClose={() => setCancelling(false)}
            onDone={() => {
              setCancelling(false);
              // ⚠️ `cancel` de ETag dönmüyor — yeniden okuma zorunlu.
              refetch();
            }}
          />
        </>
      ) : null}
    </>
  );
}
