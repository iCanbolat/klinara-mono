'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarClock, Phone, UserRound, UserX, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  ERROR_CODES,
  PERMISSIONS,
  isAppointmentStatus,
  type Appointment,
  type AppointmentHistoryEntry,
  type Service,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { ApiProblemError, api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FieldTextarea } from '@/components/ui/field';
import { dayKeyOf, formatDateTime, formatDayLabel, formatTime } from '@/lib/calendar/date';
import { STATUS_LABEL, isTerminal, statusActions } from '@/lib/calendar/status';
import { formatMoney } from '@/lib/reports/format';
import { cn } from '@/lib/cn';
import { AppointmentConsentSection } from '@/components/consent/appointment-consent-section';
import { ConsentOverrideDialog } from '@/components/consent/consent-override-dialog';
import { toneClassOf } from './appointment-block';
import { CancelDialog } from './cancel-dialog';
import { RescheduleDialog } from './reschedule-dialog';
import { StatusStepper, isFlowStatus } from './status-stepper';

/** Geçmiş satırındaki durum adı; sunucuya yeni bir durum eklenirse ham değer. */
function statusText(value: string): string {
  return isAppointmentStatus(value) ? t(STATUS_LABEL[value]) : value;
}

const HISTORY_LABEL = {
  created: 'calendar.history.created',
  rescheduled: 'calendar.history.rescheduled',
  status_changed: 'calendar.history.statusChanged',
  cancelled: 'calendar.history.cancelled',
  updated: 'calendar.history.updated',
  consent_override: 'consent.history.override',
} as const;

function historyTitle(action: string): string {
  return action in HISTORY_LABEL ? t(HISTORY_LABEL[action as keyof typeof HISTORY_LABEL]) : action;
}

/** `CONSENT_MISSING` gövdesindeki eksik onam başlıkları. */
function missingConsentTitles(error: ApiProblemError): string[] {
  const missing = error.problem['missing'];
  if (!Array.isArray(missing)) return [];
  return missing
    .map((item: unknown) =>
      typeof item === 'object' && item !== null && 'title' in item ? String(item.title) : '',
    )
    .filter((title) => title !== '');
}

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
  services,
  customer,
  staffNames,
  onClose,
  onChanged,
}: {
  appointmentId: string | null;
  timezone: string;
  /**
   * Hizmet kataloğu — satırlarda `serviceId` yerine AD göstermek için.
   *
   * `GET /appointments/:id` satırlarında (`AppointmentServiceLine`) ad YOK;
   * takvimin `CalendarServiceLine`ında var ama o başka uç. Paneli açan iki
   * sayfa (/takvim, /mesajlar) kataloğu randevu oluşturma diyaloğu için
   * ZATEN yüklüyor; panelin ayrıca `GET services` çekmesi aynı listeyi
   * ikinci kez indirmek olurdu. O yüzden prop olarak geliyor.
   */
  services: Service[];
  /**
   * Müşteri ipucu. `GET /appointments/:id` müşteri ADI dönmüyor (yalnız
   * `customerId`); paneli açan sayfalar adı zaten biliyor (takvim girdisi,
   * sohbet). `id` randevunun `customerId`siyle eşleşmezse KULLANILMIYOR:
   * yanlış müşterinin adını başlığa basmaktansa başlık boş kalır.
   */
  customer?: { id: string; name: string; phone: string | null } | null | undefined;
  /** Personel kimliği → ad; verilmezse hizmet satırında personel gösterilmez. */
  staffNames?: ReadonlyMap<string, string> | undefined;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const { permissions } = useSession();
  const [fetched, setFetched] = useState<Appointment | null>(null);
  const [history, setHistory] = useState<AppointmentHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** Onam eksik diye durdurulan geçiş; gerekçe diyaloğu açıkken dolu. */
  const [override, setOverride] = useState<{ to: string; titles: string[] } | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Başka bir randevuya geçildiğinde bir öncekinin içeriği yükleme bitene
  // kadar görünmesin.
  const appointment = fetched?.id === appointmentId ? fetched : null;

  const serviceNames = useMemo(
    () => new Map(services.map((service) => [service.id, service.name])),
    [services],
  );
  // Katalog listesi silinmiş hizmetleri DÖNMÜYOR; eski randevuda öyle bir
  // satır varsa UUID yerine açık bir etiket. Ama BOŞ katalog "henüz
  // yüklenmedi" ya da "yüklenemedi" de olabilir (takvim sayfası hatayı
  // bilerek yutuyor) — o durumda "silinmiş" demek yalan olurdu, nötr tire.
  const serviceLabel = (serviceId: string): string =>
    serviceNames.get(serviceId) ??
    (serviceNames.size === 0 ? '—' : t('calendar.detail.serviceRemoved'));

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
        setFetched(result);
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

  async function changeStatus(to: string, consentOverrideReason?: string): Promise<void> {
    if (appointment === null) return;
    setBusy(to);
    setError(null);
    setOverrideError(null);
    try {
      await api.post(`appointments/${appointment.id}/status`, {
        status: to,
        ...(consentOverrideReason === undefined ? {} : { consentOverrideReason }),
      });
      setOverride(null);
      toast.success(t('calendar.updated'));
      // ⚠️ ETag DÖNMÜYOR — yeniden okumak ZORUNLU.
      refetch();
    } catch (caught) {
      // İşlem onamı eksik: yumuşak uyarı. Hata değil, bir karar noktası —
      // personel ya imza alır ya da gerekçe yazıp devam eder.
      if (caught instanceof ApiProblemError && caught.code === ERROR_CODES.CONSENT_MISSING) {
        setOverride({ to, titles: missingConsentTitles(caught) });
      } else if (consentOverrideReason !== undefined) {
        setOverrideError(toMessage(caught));
      } else {
        setError(toMessage(caught));
      }
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
      setFetched(updated);
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
  const terminal = isTerminal(status);
  // Tamamlanmış randevu ertelenmez; iptali yalnız `appointment:reopen` ile.
  const canReschedule = appointment !== null && !terminal && status !== 'completed';
  const cancelAction = actions.find((action) => action.to === 'cancelled');
  const noShowAction = actions.find((action) => action.to === 'no_show');
  // Müşteri ipucu yalnız aynı müşteriye aitse (bkz. prop açıklaması).
  const who =
    appointment !== null && customer != null && customer.id === appointment.customerId
      ? customer
      : null;
  const canOpenCustomer = permissions.includes(PERMISSIONS.CUSTOMER_READ);
  const dayLabel =
    appointment === null ? '' : formatDayLabel(dayKeyOf(appointment.startsAt, timezone));
  const totalMinutes =
    appointment === null
      ? 0
      : appointment.services.reduce((sum, line) => sum + line.durationMinutes, 0);

  return (
    <>
      <Sheet open={appointmentId !== null} onOpenChange={(next) => !next && onClose()}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="gap-2 border-b p-5 pr-12">
            {appointment === null ? (
              <>
                <SheetTitle>{t('calendar.detail.title')}</SheetTitle>
                <SheetDescription className="sr-only">
                  {t('calendar.detail.title')}
                </SheetDescription>
                {error === null ? (
                  <div className="flex flex-col gap-2" aria-busy="true">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <SheetDescription className="text-xs font-medium uppercase tracking-wide">
                      {dayLabel}
                    </SheetDescription>
                    <SheetTitle className="text-title-m truncate">
                      {who?.name ?? t('calendar.detail.title')}
                    </SheetTitle>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn('mt-0.5 border px-2.5 py-1', toneClassOf(status))}
                  >
                    {t(STATUS_LABEL[status])}
                  </Badge>
                </div>
                <p className="text-sm tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {formatTime(appointment.startsAt, timezone)} –{' '}
                    {formatTime(appointment.endsAt, timezone)}
                  </span>
                  {totalMinutes > 0 ? ` · ${String(totalMinutes)} dk` : ''}
                </p>
                {who !== null && (who.phone !== null || canOpenCustomer) ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {who.phone !== null ? (
                      <a
                        href={`tel:${who.phone}`}
                        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="size-3.5" aria-hidden="true" />
                        <span className="tabular-nums">{who.phone}</span>
                        <span className="sr-only">{t('calendar.detail.call')}</span>
                      </a>
                    ) : null}
                    {canOpenCustomer ? (
                      <Link
                        href={`/musteriler/${appointment.customerId}`}
                        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <UserRound className="size-3.5" aria-hidden="true" />
                        {t('calendar.detail.customerProfile')}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
            {error !== null ? (
              <Alert tone="danger">
                <span role="alert">{error}</span>
              </Alert>
            ) : null}

            {appointment === null ? (
              error === null ? (
                <p className="text-sm text-muted-foreground" aria-busy="true">
                  {t('calendar.loading')}
                </p>
              ) : null
            ) : (
              <>
                <section className="flex flex-col gap-3">
                  <h3 className="text-label">{t('calendar.detail.status')}</h3>
                  {isFlowStatus(status) ? (
                    <StatusStepper
                      status={status}
                      actions={actions}
                      busy={busy}
                      onSelect={(to) => void changeStatus(to)}
                    />
                  ) : (
                    <div
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-sm',
                        toneClassOf(status),
                      )}
                    >
                      <span className="inline-flex items-center gap-2 font-semibold">
                        {status === 'cancelled' ? (
                          <XCircle className="size-4" aria-hidden="true" />
                        ) : (
                          <UserX className="size-4" aria-hidden="true" />
                        )}
                        {t(STATUS_LABEL[status])}
                      </span>
                      {status === 'cancelled' && appointment.cancellationReason !== null ? (
                        <span className="text-muted-foreground">
                          {t('calendar.detail.cancelReason')}: {appointment.cancellationReason}
                        </span>
                      ) : null}
                      {terminal ? (
                        <span className="text-xs text-muted-foreground">
                          {t('calendar.detail.terminalHint')}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {noShowAction !== undefined ? (
                    <ConfirmButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start text-muted-foreground"
                      disabled={!noShowAction.allowed || busy !== null}
                      confirmLabel={t('calendar.status.noShow')}
                      title={t('calendar.detail.noShowConfirmTitle')}
                      description={t('calendar.detail.noShowConfirmBody')}
                      destructive
                      onConfirm={() => void changeStatus('no_show')}
                    >
                      <UserX aria-hidden="true" />
                      {t('calendar.detail.markNoShow')}
                    </ConfirmButton>
                  ) : null}
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="text-label">{t('calendar.detail.services')}</h3>
                  <ul className="flex flex-col divide-y divide-border rounded-lg border">
                    {appointment.services.map((line) => {
                      const staffName = staffNames?.get(line.staffProfileId);
                      return (
                        <li
                          key={line.id}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {serviceLabel(line.serviceId)}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {[staffName, `${String(line.durationMinutes)} dk`]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatMoney(line.priceMinor)}
                          </span>
                        </li>
                      );
                    })}
                    <li className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2.5 text-sm font-semibold">
                      <span>{t('calendar.detail.total')}</span>
                      <span className="tabular-nums">{formatMoney(appointment.totalMinor)}</span>
                    </li>
                  </ul>
                </section>

                <AppointmentConsentSection
                  appointmentId={appointment.id}
                  refreshKey={appointment.version}
                />

                <section className="flex flex-col gap-2">
                  <FieldTextarea
                    label={t('calendar.detail.notes')}
                    rows={3}
                    placeholder={t('calendar.detail.notesPlaceholder')}
                    value={notes}
                    disabled={busy !== null}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    loading={busy === 'notes'}
                    disabled={busy !== null}
                    onClick={() => void saveNotes()}
                  >
                    {t('calendar.detail.saveNotes')}
                  </Button>
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-label">{t('calendar.detail.history')}</h3>
                  {history === null || history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {history === null ? '' : t('calendar.detail.historyEmpty')}
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-3 border-l border-border pl-4">
                      {history.map((entry) => (
                        <li key={entry.id} className="relative flex flex-col gap-0.5 text-sm">
                          <span
                            className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary"
                            aria-hidden="true"
                          />
                          <span className="font-medium">{historyTitle(entry.action)}</span>
                          {entry.fromStatus !== null && entry.toStatus !== null ? (
                            <span className="text-muted-foreground">
                              {statusText(entry.fromStatus)} → {statusText(entry.toStatus)}
                            </span>
                          ) : null}
                          {entry.oldStartsAt !== null && entry.newStartsAt !== null ? (
                            <span className="tabular-nums text-muted-foreground">
                              {formatDateTime(entry.oldStartsAt, timezone)} →{' '}
                              {formatDateTime(entry.newStartsAt, timezone)}
                            </span>
                          ) : null}
                          {entry.reason !== null && entry.reason !== '' ? (
                            <span className="text-muted-foreground">{entry.reason}</span>
                          ) : null}
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatDateTime(entry.createdAt, timezone)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}
          </div>

          {appointment !== null && (canReschedule || cancelAction !== undefined) ? (
            <div
              className={cn(
                'flex flex-wrap items-center gap-2 border-t bg-background p-4',
                canReschedule ? 'justify-between' : 'justify-end',
              )}
            >
              {canReschedule ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setRescheduling(true)}
                >
                  <CalendarClock aria-hidden="true" />
                  {t('calendar.action.reschedule')}
                </Button>
              ) : null}
              {cancelAction !== undefined ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={!cancelAction.allowed || busy !== null}
                  title={
                    cancelAction.reasonKey === undefined ? undefined : t(cancelAction.reasonKey)
                  }
                  onClick={() => setCancelling(true)}
                >
                  {t('calendar.action.cancel')}
                </Button>
              ) : null}
            </div>
          ) : null}
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
          <ConsentOverrideDialog
            open={override !== null}
            missingTitles={override?.titles ?? []}
            busy={busy !== null}
            error={overrideError}
            canCollect={permissions.includes(PERMISSIONS.CONSENT_COLLECT)}
            onCollect={() =>
              router.push(
                `/imza/randevu/${appointment.id}?donus=${encodeURIComponent(pathname)}`,
              )
            }
            onConfirm={(reason) => {
              if (override !== null) void changeStatus(override.to, reason);
            }}
            onClose={() => {
              setOverride(null);
              setOverrideError(null);
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
