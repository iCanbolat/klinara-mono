'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CustomerNote, CustomerNoteKind } from '@klinara/shared';
import { t, type MessageKey } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSelect, FieldTextarea } from '@/components/ui/field';
import { canWriteNote, isStale, noteVisibility } from '@/lib/customers/notes';

const KIND_LABEL: Record<CustomerNoteKind, MessageKey> = {
  general: 'customers.notes.general',
  treatment: 'customers.notes.treatment',
  internal: 'customers.notes.internal',
};

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
  const [kind, setKind] = useState<CustomerNoteKind>('general');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
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

  async function addNote(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`customers/${customerId}/notes`, { body: body.trim(), kind });
      toast.success(t('customers.notes.saved'));
      setBody('');
      setNonce((value) => value + 1);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const writableKinds = visibility.kinds.filter((value) => canWriteNote(permissions, value));

  return (
    <div className="flex flex-col gap-4">
      {visibility.medicalHidden ? (
        // "Göremiyorum" ile "yok" farkı — bkz. dosya başlığı.
        <Alert tone="info">{t('customers.notes.medicalHidden')}</Alert>
      ) : null}

      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {writableKinds.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <FieldSelect
            label="Tür"
            value={kind}
            disabled={busy}
            onChange={(event) => setKind(event.target.value as CustomerNoteKind)}
          >
            {writableKinds.map((value) => (
              <option key={value} value={value}>
                {t(KIND_LABEL[value])}
              </option>
            ))}
          </FieldSelect>
          <FieldTextarea
            label={t('customers.notes.body')}
            rows={3}
            value={body}
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="self-start"
            loading={busy}
            disabled={busy || body.trim() === ''}
            onClick={() => void addNote()}
          >
            {t('customers.notes.add')}
          </Button>
        </div>
      ) : null}

      {notes !== null && notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('customers.notes.empty')}</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {(notes ?? []).map((note) => {
          const stale = isStale(openedVersions[note.id] ?? note.version, note);
          return (
            <li key={note.id} className="rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{t(KIND_LABEL[note.kind])}</span>
                <span className="tabular-nums">v{note.version}</span>
              </div>
              {stale ? <Alert tone="warn">{t('customers.notes.stale')}</Alert> : null}
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
