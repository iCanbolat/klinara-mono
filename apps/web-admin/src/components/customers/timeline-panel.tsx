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
 * ⚠️ Akış YALNIZ randevu ve not içeriyor. Paket satışı/tüketimi ve tahsilat
 * defterde duruyor ama bu sorguya hiç eklenmedi (Faz 5'ten devreden açık
 * madde; `notes.repository.ts:132` `listTimeline` yalnız iki koldan `union`
 * yapıyor).
 *
 * Bu boşluk ekranda AÇIKÇA SÖYLENİYOR. Sessizce gizlemek, kullanıcının
 * "bu müşteriye hiç paket satılmamış" diye düşünmesine yol açardı — oysa
 * satılmış olabilir ve bu akış onu göstermiyor.
 */
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
      {/* Boşluk sessizce gizlenmiyor — bkz. dosya başlığı. */}
      <p className="text-xs text-muted-foreground">{t('customers.timeline.partial')}</p>

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
            <span className="mr-2 text-xs uppercase text-muted-foreground">{entry.kind}</span>
            <time dateTime={entry.occurredAt} className="tabular-nums">
              {new Intl.DateTimeFormat('tr-TR', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(entry.occurredAt))}
            </time>
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
