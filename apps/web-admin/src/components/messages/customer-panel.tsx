'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CalendarPlus, ExternalLink, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  isAppointmentStatus,
  PERMISSIONS,
  type CalendarEntry,
  type Conversation,
  type Page,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { can, canAny } from '@/lib/permissions';
import { toMessage } from '@/lib/reports/errors';
import { formatPhone } from '@/lib/messages/format';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/calendar/status';
import { cn } from '@/lib/cn';
import { useSession } from '@/components/session/session-provider';
import { useBranch } from '@/components/session/branch-provider';
import { CustomerPicker } from '@/components/pickers/customer-picker';
import type { ComboboxOption } from '@/components/ui/combobox';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Geçmiş 30 gün + önümüzdeki 60 gün. Toplam 92 günü AŞAMAZ: `GET appointments`
 * daha geniş aralığı 422 ile reddediyor.
 */
const PAST_DAYS = 30;
const FUTURE_DAYS = 60;

const TONE_CLASS = {
  info: 'bg-muted text-foreground',
  ok: 'bg-success-soft text-foreground',
  warn: 'bg-warning-soft text-foreground',
  danger: 'bg-destructive-soft text-foreground',
} as const;

export function CustomerPanel({
  conversation,
  refreshKey,
  onConversationChange,
  onOpenAppointment,
  onCreateAppointment,
}: {
  conversation: Conversation;
  /** Randevu değişince (sheet, oluşturma) liste yeniden okunur. */
  refreshKey: number;
  onConversationChange: (conversation: Conversation) => void;
  onOpenAppointment: (appointmentId: string) => void;
  onCreateAppointment: () => void;
}): ReactNode {
  const { permissions } = useSession();
  const canReadAppointments = canAny(
    permissions,
    PERMISSIONS.APPOINTMENT_READ_ALL,
    PERMISSIONS.APPOINTMENT_READ_OWN,
  );
  const canWriteAppointments = can(permissions, PERMISSIONS.APPOINTMENT_WRITE);

  return (
    <div className="flex flex-col gap-5 p-4">
      <section className="flex flex-col gap-2" aria-labelledby="panel-customer">
        <h3 id="panel-customer" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('messages.panel.customer')}
        </h3>
        {conversation.customer === null ? (
          <LinkCustomer conversation={conversation} onLinked={onConversationChange} />
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-foreground">{conversation.customer.fullName}</p>
            <p className="text-sm text-muted-foreground">{formatPhone(conversation.phone)}</p>
            {can(permissions, PERMISSIONS.CUSTOMER_READ) ? (
              <Link
                href={`/musteriler/${conversation.customer.id}`}
                className="mt-1 inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {t('messages.panel.openCustomer')}
              </Link>
            ) : null}
          </div>
        )}
      </section>

      {conversation.customer !== null && canReadAppointments ? (
        <Appointments
          customerId={conversation.customer.id}
          refreshKey={refreshKey}
          canWrite={canWriteAppointments}
          onOpen={onOpenAppointment}
          onCreate={onCreateAppointment}
        />
      ) : null}
    </div>
  );
}

function LinkCustomer({
  conversation,
  onLinked,
}: {
  conversation: Conversation;
  onLinked: (conversation: Conversation) => void;
}): ReactNode {
  const { permissions } = useSession();
  const [selected, setSelected] = useState<ComboboxOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link(): Promise<void> {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.put<Conversation>(`conversations/${conversation.id}/customer`, {
        customerId: selected.id,
      });
      toast.success(t('messages.panel.linked'));
      onLinked(updated);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{formatPhone(conversation.phone)}</p>
      <Alert tone="info">{t('messages.panel.unlinked')}</Alert>
      {can(permissions, PERMISSIONS.CUSTOMER_READ) ? (
        <>
          <CustomerPicker
            value={selected}
            onSelect={setSelected}
            canCreate={false}
          />
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <Button
            size="sm"
            className="self-start"
            disabled={selected === null}
            loading={busy}
            onClick={() => void link()}
          >
            <Link2 aria-hidden="true" />
            {t('messages.panel.link')}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function Appointments({
  customerId,
  refreshKey,
  canWrite,
  onOpen,
  onCreate,
}: {
  customerId: string;
  refreshKey: number;
  canWrite: boolean;
  onOpen: (appointmentId: string) => void;
  onCreate: () => void;
}): ReactNode {
  const { branches } = useBranch();
  /** `at`: okuma anı — yaklaşan/geçmiş ayrımı render'da `Date.now()` çağırmasın. */
  const [entries, setEntries] = useState<{ rows: CalendarEntry[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [listKey, setListKey] = useState(customerId);
  if (listKey !== customerId) {
    setListKey(customerId);
    setEntries(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const now = Date.now();
        const params = new URLSearchParams({
          customerId,
          from: new Date(now - PAST_DAYS * DAY_MS).toISOString(),
          to: new Date(now + FUTURE_DAYS * DAY_MS).toISOString(),
          limit: '50',
        });
        const page = await api.get<Page<CalendarEntry>>(`appointments?${params.toString()}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setEntries({ rows: page.data, at: now });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [customerId, refreshKey]);

  const timezones = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.timezone])),
    [branches],
  );
  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  const [upcoming, past] = useMemo(() => {
    if (entries === null) return [[], []] as const;
    const now = entries.at;
    const sorted = [...entries.rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return [
      sorted.filter((entry) => new Date(entry.endsAt).getTime() >= now),
      sorted.filter((entry) => new Date(entry.endsAt).getTime() < now).reverse(),
    ] as const;
  }, [entries]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="panel-appointments">
      <div className="flex items-center justify-between gap-2">
        <h3 id="panel-appointments" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('messages.panel.appointments')}
        </h3>
        {canWrite ? (
          <Button size="sm" variant="secondary" onClick={onCreate}>
            <CalendarPlus aria-hidden="true" />
            {t('messages.panel.newAppointment')}
          </Button>
        ) : null}
      </div>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {entries === null && error === null ? <Skeleton className="h-20 w-full rounded-lg" /> : null}

      {entries !== null ? (
        <>
          <AppointmentGroup
            title={t('messages.panel.upcoming')}
            empty={t('messages.panel.noUpcoming')}
            entries={upcoming}
            timezones={timezones}
            branchNames={branchNames}
            showBranch={branches.length > 1}
            onOpen={onOpen}
          />
          <AppointmentGroup
            title={t('messages.panel.past')}
            empty={t('messages.panel.noPast')}
            entries={past}
            timezones={timezones}
            branchNames={branchNames}
            showBranch={branches.length > 1}
            onOpen={onOpen}
          />
        </>
      ) : null}
    </section>
  );
}

function AppointmentGroup({
  title,
  empty,
  entries,
  timezones,
  branchNames,
  showBranch,
  onOpen,
}: {
  title: string;
  empty: string;
  entries: readonly CalendarEntry[];
  timezones: ReadonlyMap<string, string>;
  branchNames: ReadonlyMap<string, string>;
  showBranch: boolean;
  onOpen: (appointmentId: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((entry) => {
            const timeZone = timezones.get(entry.branchId) ?? 'Europe/Istanbul';
            const when = new Intl.DateTimeFormat('tr-TR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone,
            }).format(new Date(entry.startsAt));
            const status = isAppointmentStatus(entry.status) ? entry.status : null;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onOpen(entry.id)}
                  className="flex w-full flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{when}</span>
                    {status !== null ? (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          TONE_CLASS[STATUS_TONE[status]],
                        )}
                      >
                        {t(STATUS_LABEL[status])}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.services.map((line) => line.serviceName).join(', ')}
                    {showBranch ? ` · ${branchNames.get(entry.branchId) ?? ''}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
