'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CONSENT_LIMITS,
  PERMISSIONS,
  type ConsentDocument,
  type ConsentDocumentState,
  type ConsentDocumentSummary,
} from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { can } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { toast } from 'sonner';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

/**
 * Faz 7 — tek zorunlu KVKK/aydınlatma onam metni.
 *
 * Metin bir AYAR değil, sürümlü bir belge: yayınlanan sürüm bir daha
 * değiştirilemez, düzeltme yeni bir sürüm üretir. Ekran bunu gizlemiyor —
 * yayındaki metin salt okunur, düzenleme taslakta yapılıyor ve yayınlama
 * geri alınamaz bir eylem olarak onay arkasında.
 */
function ConsentEditor(): ReactNode {
  const { permissions } = useSession();
  const canManage = can(permissions, PERMISSIONS.CONSENT_MANAGE);

  const [state, setState] = useState<ConsentDocumentState | null>(null);
  const [versions, setVersions] = useState<ConsentDocumentSummary[]>([]);
  const [draftBody, setDraftBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [next, history] = await Promise.all([
        api.get<ConsentDocumentState>('consent-document'),
        api.get<ConsentDocumentSummary[]>('consent-document/versions'),
      ]);
      setState(next);
      setVersions(history);
      // Taslak yoksa yayındaki metin başlangıç noktası: editör boş bir kutuyla
      // açılırsa kullanıcı metni sıfırdan yazmak zorunda sanır.
      setDraftBody(next.draft?.body ?? next.active?.body ?? '');
    } catch (caught) {
      setError(toMessage(caught));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await action();
      await load();
      toast.success(message);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (state === null) {
    return error !== null ? (
      <Alert tone="danger">{error}</Alert>
    ) : (
      <div className="flex max-w-3xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const { active, draft } = state;
  const trimmed = draftBody.trim();
  const draftDirty = trimmed !== (draft?.body ?? '');

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('consent.title')} description={t('consent.subtitle')} />
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {active === null ? (
        // Bu bir uyarı değil, bir ENGEL: sunucu onam metni olmayan siteyi
        // yayınlatmıyor. Kullanıcı sebebini burada görmeli.
        <Alert tone="warn">{t('consent.notPublishedWarning')}</Alert>
      ) : null}

      <Card>
        <CardTitle>{t('consent.active')}</CardTitle>
        {active === null ? (
          <p className="text-sm text-muted-foreground">{t('consent.noActive')}</p>
        ) : (
          <>
            <ActiveMeta document={active} />
            <p className="mt-3 max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
              {active.body}
            </p>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>{t('consent.draft')}</CardTitle>
        <Textarea
          value={draftBody}
          readOnly={!canManage}
          maxLength={CONSENT_LIMITS.body}
          rows={12}
          placeholder={t('consent.draftPlaceholder')}
          aria-label={t('consent.draft')}
          onChange={(event) => {
            setDraftBody(event.target.value);
          }}
        />
        {canManage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={saving || trimmed === '' || !draftDirty}
              onClick={() =>
                void run(
                  () => api.put('consent-document/draft', { body: trimmed }),
                  t('toast.saved'),
                )
              }
            >
              {t('consent.saveDraft')}
            </Button>
            <ConfirmButton
              title={t('consent.publishConfirmTitle')}
              description={t('consent.publishConfirmBody')}
              confirmLabel={t('consent.publishConfirmAction')}
              disabled={saving || (draft === null && !draftDirty) || trimmed === ''}
              onConfirm={() =>
                void run(async () => {
                  // Yayınlamadan önce taslak KAYDEDİLİYOR: kullanıcının ekranda
                  // gördüğü metin ile yayınlanan metin farklı olamaz.
                  if (draftDirty) await api.put('consent-document/draft', { body: trimmed });
                  await api.post('consent-document/publish', {});
                }, t('toast.saved'))
              }
            >
              {t('consent.publish')}
            </ConfirmButton>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t('editor.readOnly')}</p>
        )}
      </Card>

      <Card>
        <CardTitle>{t('consent.versions')}</CardTitle>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('consent.noVersions')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-0">
                <span className="font-medium">
                  {t('consent.version')} {version.version}
                </span>
                <Badge variant={version.status === 'published' ? 'default' : 'secondary'}>
                  {version.status === 'published'
                    ? t('consent.statusPublished')
                    : t('consent.statusArchived')}
                </Badge>
                <span className="text-muted-foreground">{formatDate(version.publishedAt)}</span>
                {/* Özet kısaltılıyor ama TAM değeri `title`da: bir denetimde
                    "bu metin miydi" sorusu hash'ten cevaplanıyor. */}
                <code className="ml-auto text-xs text-muted-foreground" title={version.sha256}>
                  {version.sha256.slice(0, 12)}…
                </code>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ActiveMeta({ document }: { document: ConsentDocument }): ReactNode {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{t('consent.version')}</dt>
      <dd>{document.version}</dd>
      <dt className="text-muted-foreground">{t('consent.publishedAt')}</dt>
      <dd>{formatDate(document.publishedAt)}</dd>
      <dt className="text-muted-foreground">{t('consent.checksum')}</dt>
      <dd>
        <code className="text-xs break-all">{document.sha256}</code>
      </dd>
    </dl>
  );
}

function formatDate(value: string | null): string {
  return value === null ? '—' : new Date(value).toLocaleString('tr-TR');
}

function toMessage(caught: unknown): string {
  return caught instanceof ApiProblemError
    ? describeProblem(caught.problem, caught.retryAfterSeconds).message
    : networkError().message;
}

export default function Page(): ReactNode {
  return (
    <PermissionGate required={[PERMISSIONS.CONSENT_READ]}>
      <ConsentEditor />
    </PermissionGate>
  );
}
