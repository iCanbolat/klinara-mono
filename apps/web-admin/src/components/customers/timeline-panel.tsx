'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  CalendarDays,
  CircleDot,
  History,
  Package,
  ShieldCheck,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import {
  isAppointmentStatus,
  type AppointmentStatus,
  type Page,
  type TimelineEntry,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/calendar/status';
import { cn } from '@/lib/cn';
import { formatDateTime, formatTime } from '@/lib/customers/format';
import { formatMoney } from '@/lib/format/money';
import { PanelSkeleton } from './panel-skeleton';

/**
 * Müşteri zaman tüneli.
 *
 * Akış randevu, not, onam ve PAKET olaylarını içeriyor. Paket iki koldan
 * geliyor: `package_sale` satışın kendisi (bir satış = bir satır),
 * `package_ledger` ise satış sonrası defter hareketleri (tüketim, iade,
 * devir, süre dolumu, düzeltme).
 */
/** `payload` gevşek tipli (`Record<string, unknown>`); sürüm sayı ya da yok. */
function consentVersion(payload: Record<string, unknown>): string {
  const version = payload['version'];
  return typeof version === 'number' ? String(version) : '—';
}

/** `payload` gevşek tipli; paket satırlarının okunabilir özeti. */
function packageSummary(kind: string, payload: Record<string, unknown>): string | null {
  const name = payload['definitionName'];
  if (typeof name !== 'string') return null;

  if (kind === 'package_sale') return name;

  // Defter hareketinde işaret AÇIKÇA yazılıyor: "1 seans" tek başına hakkın
  // düştüğünü mü eklendiğini mi söylediğini belirsiz bırakırdı.
  const delta = payload['delta'];
  const service = payload['serviceName'];
  const parts = [name];
  if (typeof service === 'string') parts.push(service);
  if (typeof delta === 'number') parts.push(delta > 0 ? `+${delta} seans` : `${delta} seans`);
  return parts.join(' · ');
}

/** Ham `kind` değerleri ekranda görünmemeli; sözleşme İngilizce, arayüz Türkçe. */
const KIND_LABELS: Record<string, string> = {
  appointment: t('customers.timeline.kind.appointment'),
  note: t('customers.timeline.kind.note'),
  consent: t('customers.timeline.kind.consent'),
  package_sale: t('customers.timeline.kind.packageSale'),
  package_ledger: t('customers.timeline.kind.packageLedger'),
};

export function TimelinePanel({ customerId }: { customerId: string }): ReactNode {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** "Yaklaşan" ayrımının referansı — panel açıldığı an; render'da `Date.now()` saf değil. */
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const result = await api.get<Page<TimelineEntry>>(
          `customers/${customerId}/timeline?limit=30`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setEntries(result.data);
        setCursor(result.pageInfo.nextCursor);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [customerId]);

  async function loadMore(): Promise<void> {
    if (cursor === null) return;
    setBusy(true);
    try {
      const result = await api.get<Page<TimelineEntry>>(
        `customers/${customerId}/timeline?limit=30&cursor=${encodeURIComponent(cursor)}`,
      );
      setEntries((current) => [...(current ?? []), ...result.data]);
      setCursor(result.pageInfo.nextCursor);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {entries === null && error === null ? <PanelSkeleton rows={4} /> : null}

      {entries !== null && entries.length === 0 ? (
        <EmptyState
          icon={History}
          title={t('customers.timeline.empty')}
          message={t('customers.timeline.emptyHint')}
          className="py-10"
        />
      ) : null}

      {entries !== null && entries.length > 0 ? (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <TimelineRow
              key={`${entry.kind}-${entry.id}`}
              entry={entry}
              now={now}
              last={index === entries.length - 1 && cursor === null}
            />
          ))}
        </ol>
      ) : null}

      {cursor !== null ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-center"
          loading={busy}
          onClick={() => void loadMore()}
        >
          {t('customers.loadMore')}
        </Button>
      ) : null}

      {/* Sözleşme gereği: tahsilat akışta YOK ve bu sessizce gizlenmiyor. */}
      {entries !== null && entries.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t('customers.timeline.paymentsExcluded')}</p>
      ) : null}
    </div>
  );
}

const KIND_ICON: Record<string, LucideIcon> = {
  appointment: CalendarDays,
  note: StickyNote,
  consent: ShieldCheck,
  package_sale: Package,
  package_ledger: ArrowLeftRight,
};

const TONE_CLASS = {
  info: 'bg-muted text-foreground',
  ok: 'bg-success-soft text-foreground',
  warn: 'bg-warning-soft text-foreground',
  danger: 'bg-destructive-soft text-foreground',
} as const;

/**
 * Tek satır: solda ikonlu ray, sağda başlık + ayrıntı. Ray son satırda
 * kesiliyor; "daha fazla" varken sürüyor (liste bitmedi).
 */
function TimelineRow({
  entry,
  now,
  last,
}: {
  entry: TimelineEntry;
  now: number;
  last: boolean;
}): ReactNode {
  const Icon = KIND_ICON[entry.kind] ?? CircleDot;
  const detail = detailOf(entry);
  const status = appointmentStatus(entry);
  const upcoming =
    entry.kind === 'appointment' &&
    new Date(entry.occurredAt).getTime() > now &&
    status !== 'cancelled';

  return (
    <li className="relative flex gap-4 pb-5 last:pb-0">
      {last ? null : (
        <span aria-hidden="true" className="absolute top-9 bottom-0 left-4 w-px bg-border" />
      )}
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-body-emphasis text-foreground">
            {KIND_LABELS[entry.kind] ?? entry.kind}
          </span>
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
          {upcoming ? <Badge variant="outline">{t('customers.timeline.upcoming')}</Badge> : null}
          <time
            dateTime={entry.occurredAt}
            className="ml-auto text-xs tabular-nums text-muted-foreground"
          >
            {formatDateTime(entry.occurredAt)}
          </time>
        </div>
        {detail === null ? null : (
          <p className="truncate text-sm text-muted-foreground">{detail}</p>
        )}
      </div>
    </li>
  );
}

function appointmentStatus(entry: TimelineEntry): AppointmentStatus | null {
  if (entry.kind !== 'appointment') return null;
  const status = entry.payload['status'];
  return typeof status === 'string' && isAppointmentStatus(status) ? status : null;
}

/** Türe göre tek satırlık özet; gösterecek bir şey yoksa `null`. */
function detailOf(entry: TimelineEntry): string | null {
  const payload = entry.payload;
  switch (entry.kind) {
    case 'appointment': {
      const parts: string[] = [];
      const ends = payload['endsAt'];
      parts.push(
        typeof ends === 'string'
          ? `${formatTime(entry.occurredAt)}–${formatTime(ends)}`
          : formatTime(entry.occurredAt),
      );
      const total = payload['totalMinor'];
      if (typeof total === 'number' && total > 0) parts.push(formatMoney(total));
      return parts.join(' · ');
    }
    case 'note': {
      const body = payload['body'];
      return typeof body === 'string' && body.trim() !== '' ? body.replace(/\s+/g, ' ') : null;
    }
    case 'consent':
      return `${t('customers.timeline.consentVersion')} ${consentVersion(payload)}`;
    case 'package_sale': {
      const name = packageSummary(entry.kind, payload);
      if (name === null) return null;
      const parts = [name];
      const price = payload['totalPriceMinor'];
      const currency = payload['currency'];
      if (typeof price === 'number') {
        parts.push(formatMoney(price, typeof currency === 'string' ? currency : 'TRY'));
      }
      const remaining = payload['remainingSessions'];
      if (typeof remaining === 'number') {
        parts.push(t('customers.timeline.sessionsLeft', { count: remaining }));
      }
      return parts.join(' · ');
    }
    case 'package_ledger':
      return packageSummary(entry.kind, payload);
    default:
      return null;
  }
}
