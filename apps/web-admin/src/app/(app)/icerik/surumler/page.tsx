'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PERMISSIONS, REVISION_HISTORY_LIMIT, type RevisionSummary } from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { can } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Batch 11.5 — sürüm geçmişi ve geri alma. */
function Revisions(): ReactNode {
  const { permissions } = useSession();
  const canManage = can(permissions, PERMISSIONS.BOOKING_PAGE_MANAGE);

  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRevisions(await api.get<RevisionSummary[]>('booking-page/content/revisions'));
    } catch (caught) {
      setError(toMessage(caught));
    }
  }, []);

  useEffect(() => {
    // Efekt gövdesinde `void load()` çağırmak, lint için setState'i SENKRON
    // çağırmak sayılıyor (`react-hooks/set-state-in-effect`). Async sarmalayıcı
    // durum güncellemesini promise geri çağrısına taşıyor.
    void (async () => {
      await load();
    })();
  }, [load]);

  async function rollback(id: string): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      await api.post(`booking-page/content/rollback/${id}`);
      await load();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">{t('editor.revisions')}</h1>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {/* Sınır GİZLENMİYOR: kullanıcı 51. sürümün nereye gittiğini sormadan
          önce cevabı görsün. */}
      <p className="text-sm text-ink-soft">
        Son {REVISION_HISTORY_LIMIT} sürüm gösterilir.
      </p>

      {revisions === null ? (
        <p className="text-sm text-ink-soft">{t('common.loading')}</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('editor.revisions')}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-soft">
              <th scope="col" className="py-2">Sürüm</th>
              <th scope="col">Tarih</th>
              <th scope="col">Durum</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {revisions.map((revision) => (
              <tr key={revision.id} className="border-b border-line">
                <td className="py-2">{revision.revisionNumber}</td>
                <td>{new Date(revision.createdAt).toLocaleString('tr-TR')}</td>
                <td>
                  {revision.isPublished ? (
                    <span className="rounded-full border border-ok bg-ok-soft px-2 py-0.5 text-xs">
                      {t('editor.revisionCurrent')}
                    </span>
                  ) : null}
                </td>
                <td className="text-right">
                  {canManage && !revision.isPublished ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === revision.id}
                      onClick={() => void rollback(revision.id)}
                    >
                      {t('editor.rollback')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function toMessage(caught: unknown): string {
  return caught instanceof ApiProblemError
    ? describeProblem(caught.problem, caught.retryAfterSeconds).message
    : networkError().message;
}

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.BOOKING_PAGE_READ]}>
      <Revisions />
    </PermissionGate>
  );
}
