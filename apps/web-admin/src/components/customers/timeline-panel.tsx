'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Page, TimelineEntry } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
    <div className="flex flex-col gap-3">
      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {entries !== null && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('customers.timeline.empty')}</p>
      ) : null}

      <ol className="flex flex-col gap-2">
        {(entries ?? []).map((entry) => (
          <li key={`${entry.kind}-${entry.id}`} className="rounded-lg border border-border p-2 text-sm">
            <span className="mr-2 text-xs uppercase text-muted-foreground">
              {KIND_LABELS[entry.kind] ?? entry.kind}
            </span>
            <time dateTime={entry.occurredAt} className="tabular-nums">
              {new Intl.DateTimeFormat('tr-TR', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(entry.occurredAt))}
            </time>
            {/* Onam satırı SÜRÜMÜ taşıyor: "kabul etti" tek başına kanıt
                değil, hangi metni kabul ettiği kanıt. Metnin tamamı burada
                değil — `consent-acceptances` ucundan çekiliyor. */}
            {entry.kind === 'consent' ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {t('customers.timeline.consentVersion')} {consentVersion(entry.payload)}
              </span>
            ) : null}
            {entry.kind === 'package_sale' || entry.kind === 'package_ledger' ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {packageSummary(entry.kind, entry.payload)}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {cursor !== null ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          loading={busy}
          onClick={() => void loadMore()}
        >
          {t('customers.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
