'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { NotebookPen, Plus } from 'lucide-react';
import type { CustomerNote } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/customers/format';
import { canWriteNote, isStale, noteVisibility } from '@/lib/customers/notes';
import { NOTE_KIND_LABEL as KIND_LABEL, NoteDialog } from './note-dialog';
import { PanelSkeleton } from './panel-skeleton';

/**
 * Müşteri notları.
 *
 * ---------------------------------------------------------------------------
 * SUNUCUNUN SESSİZLİĞİ EKRANDA TELAFİ EDİLİYOR
 * ---------------------------------------------------------------------------
 * `customer.medical:read` izni olmayan bir kullanıcıya `treatment` ve
 * `internal` notlar SESSİZCE dönmüyor — yanıtta "gizlendi" bayrağı yok.
 *
 * Boş bir "Tedavi" sekmesi göstermek, resepsiyona "bu müşterinin tedavi
 * notu yok" der. Bu YANLIŞ BİLGİ ve kliniğin en hassas verisi hakkında.
 * Bu yüzden sekme HİÇ gösterilmiyor ve yerine bir satır yazılıyor:
 * "göremiyorum" ile "yok" arasındaki fark açıkça söyleniyor.
 *
 * ---------------------------------------------------------------------------
 * SÜRÜM DEĞİŞTİYSE ÖNCEDEN SÖYLENİYOR
 * ---------------------------------------------------------------------------
 * `PATCH /notes/:id` artık `If-Match` ZORUNLU tutuyor: bayat sürümle kaydetme
 * `409` alır. Not açılırken okunan sürüm saklanıyor ve sunucudan dönen sürüm
 * daha yüksekse uyarı basılıyor — kaydetme reddedileceği için bu bir telafi
 * değil, ön haber. (Bu panelde düzenleme arayüzü henüz yok; sürüm izleme
 * düzenleme geldiğinde hazır olsun diye duruyor.)
 */
export function NotesPanel({ customerId }: { customerId: string }): ReactNode {
  const { permissions } = useSession();
  const visibility = noteVisibility(permissions);

  const [notes, setNotes] = useState<CustomerNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nonce, setNonce] = useState(0);
  /** Not kimliği → panelin açıldığı andaki sürüm. */
  const [openedVersions, setOpenedVersions] = useState<Record<string, number>>({});

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const result = await api.get<{ data: CustomerNote[] }>(`customers/${customerId}/notes`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setNotes(result.data);
        setOpenedVersions((current) => {
          const next = { ...current };
          for (const note of result.data) next[note.id] ??= note.version;
          return next;
        });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [customerId, nonce]);

  const writableKinds = visibility.kinds.filter((value) => canWriteNote(permissions, value));

  return (
    <div className="flex flex-col gap-5">
      {visibility.medicalHidden ? (
        // "Göremiyorum" ile "yok" farkı — bkz. dosya başlığı.
        <Alert tone="info">{t('customers.notes.medicalHidden')}</Alert>
      ) : null}

      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {writableKinds.length > 0 || (notes !== null && notes.length > 0) ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {notes === null || notes.length === 0
              ? ''
              : t('customers.notes.count', { count: notes.length })}
          </p>
          {writableKinds.length > 0 ? (
            <Button type="button" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              {t('customers.notes.add')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {notes === null && error === null ? <PanelSkeleton /> : null}

      {notes !== null && notes.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title={t('customers.notes.empty')}
          message={t(
            writableKinds.length > 0
              ? 'customers.notes.emptyHint'
              : 'customers.notes.emptyReadOnly',
          )}
          className="py-10"
        />
      ) : null}

      {notes !== null && notes.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => {
            const stale = isStale(openedVersions[note.id] ?? note.version, note);
            return (
              <li
                key={note.id}
                className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant={note.kind === 'general' ? 'secondary' : 'outline'}>
                    {t(KIND_LABEL[note.kind])}
                  </Badge>
                  <time
                    dateTime={note.createdAt}
                    className="text-xs tabular-nums text-muted-foreground"
                  >
                    {formatDateTime(note.createdAt)}
                  </time>
                  {note.version > 1 ? (
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {t('customers.notes.version', { version: note.version })}
                    </span>
                  ) : null}
                </div>
                {stale ? <Alert tone="warn">{t('customers.notes.stale')}</Alert> : null}
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                  {note.body}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      <NoteDialog
        open={adding}
        customerId={customerId}
        kinds={writableKinds}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          setNonce((value) => value + 1);
        }}
      />
    </div>
  );
}
