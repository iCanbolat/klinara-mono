'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CONSENT_LIMITS,
  PERMISSIONS,
  type ConsentDocumentState,
  type ConsentDocumentSummary,
} from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { can } from '@/lib/permissions';
import { useSession } from '@/components/session/session-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { toast } from 'sonner';
import { Copy, FileSignature, History, Pencil, Send, ShieldCheck } from 'lucide-react';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { TreatmentTemplates } from '@/components/consent/treatment-templates';

/**
 * Faz 7 — tek zorunlu KVKK/aydınlatma onam metni.
 *
 * Metin bir AYAR değil, sürümlü bir belge: yayınlanan sürüm bir daha
 * değiştirilemez, düzeltme yeni bir sürüm üretir. Ekran bunu gizlemiyor —
 * varsayılan görünüm yayındaki metni bir BELGE gibi okutuyor, düzenleme ayrı
 * bir moda ("Yeni sürüm hazırla") geçerek taslakta yapılıyor ve yayınlama
 * geri alınamaz bir eylem olarak onay arkasında.
 *
 * Kaydedilmiş bir taslak varsa sayfa bunu açıkça söylüyor: aksi hâlde
 * yarım kalmış bir düzeltme, kimse fark etmeden aylarca yayınlanmamış kalırdı.
 */
function ConsentEditor(): ReactNode {
  const { permissions } = useSession();
  const canManage = can(permissions, PERMISSIONS.CONSENT_MANAGE);

  const [state, setState] = useState<ConsentDocumentState | null>(null);
  const [versions, setVersions] = useState<ConsentDocumentSummary[]>([]);
  const [draftBody, setDraftBody] = useState('');
  const [editing, setEditing] = useState(false);
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
      return next;
    } catch (caught) {
      setError(toMessage(caught));
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const next = await load();
      // Yayında metin yoksa okunacak bir şey de yok: doğrudan editör.
      if (next !== null && next.active === null) setEditing(true);
    })();
  }, [load]);

  async function run(
    action: () => Promise<unknown>,
    message: string,
    after?: () => void,
  ): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await action();
      await load();
      after?.();
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
      <div className="flex max-w-5xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const { active, draft } = state;
  const trimmed = draftBody.trim();
  const draftDirty = trimmed !== (draft?.body ?? '');
  const sameAsActive = draft === null && trimmed === (active?.body ?? '');
  const nextVersion = (versions[0]?.version ?? active?.version ?? 0) + 1;
  const showEditor = canManage && editing;

  function cancelEditing(): void {
    setDraftBody(draft?.body ?? active?.body ?? '');
    setEditing(active === null);
  }

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader title={t('consent.title')} description={t('consent.subtitle')} />
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {active === null ? (
        // Bu bir uyarı değil, bir ENGEL: sunucu onam metni olmayan siteyi
        // yayınlatmıyor. Kullanıcı sebebini burada görmeli.
        <Alert tone="warn">{t('consent.notPublishedWarning')}</Alert>
      ) : null}

      {draft !== null && !showEditor ? (
        <Alert tone="info" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('consent.pendingDraft')}</span>
          {canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {t('consent.continueDraft')}
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {showEditor ? (
          <Card className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>
                  {active === null ? t('consent.firstVersion') : t('consent.newVersion')}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('consent.editorHint', { version: nextVersion })}
                </p>
              </div>
              {draft !== null ? <Badge variant="outline">{t('consent.draftSaved')}</Badge> : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Textarea
                value={draftBody}
                maxLength={CONSENT_LIMITS.body}
                rows={18}
                className="min-h-80 bg-card text-[0.9375rem] leading-relaxed"
                placeholder={t('consent.draftPlaceholder')}
                aria-label={t('consent.draft')}
                disabled={saving}
                onChange={(event) => {
                  setDraftBody(event.target.value);
                }}
              />
              <p className="self-end text-xs tabular-nums text-muted-foreground">
                {draftBody.length.toLocaleString('tr-TR')} /{' '}
                {CONSENT_LIMITS.body.toLocaleString('tr-TR')}
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              {active !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  disabled={saving}
                  onClick={cancelEditing}
                >
                  {t('consent.cancel')}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={saving || trimmed === '' || !draftDirty || sameAsActive}
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
                  className="w-full sm:w-auto"
                  title={t('consent.publishConfirmTitle')}
                  description={t('consent.publishConfirmBody')}
                  confirmLabel={t('consent.publishConfirmAction')}
                  disabled={
                    saving || trimmed === '' || sameAsActive || (draft === null && !draftDirty)
                  }
                  onConfirm={() =>
                    void run(
                      async () => {
                        // Yayınlamadan önce taslak KAYDEDİLİYOR: kullanıcının
                        // ekranda gördüğü metin ile yayınlanan metin farklı olamaz.
                        if (draftDirty) await api.put('consent-document/draft', { body: trimmed });
                        await api.post('consent-document/publish', {});
                      },
                      t('consent.published', { version: nextVersion }),
                      () => setEditing(false),
                    )
                  }
                >
                  <Send aria-hidden="true" />
                  {t('consent.publishVersion', { version: nextVersion })}
                </ConfirmButton>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <CardTitle>{t('consent.active')}</CardTitle>
                {active !== null ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge>
                      {t('consent.version')} {active.version}
                    </Badge>
                    <span>{formatDate(active.publishedAt)}</span>
                  </p>
                ) : null}
              </div>
              {canManage && active !== null ? (
                <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" />
                  {draft !== null ? t('consent.continueDraft') : t('consent.newVersion')}
                </Button>
              ) : null}
            </div>

            {active === null ? (
              <EmptyState icon={FileSignature} title={t('consent.noActive')} />
            ) : (
              <article className="max-h-[60vh] overflow-y-auto rounded-lg border bg-muted/30 px-5 py-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-foreground">
                {active.body}
              </article>
            )}

            {!canManage ? (
              <p className="text-sm text-muted-foreground">{t('editor.readOnly')}</p>
            ) : null}
          </Card>
        )}

        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History aria-hidden="true" className="size-4 text-muted-foreground" />
              {t('consent.versions')}
            </CardTitle>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('consent.noVersions')}</p>
            ) : (
              <ol className="flex flex-col">
                {versions.map((version) => (
                  <VersionRow key={version.id} version={version} />
                ))}
              </ol>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
              {t('consent.howTitle')}
            </CardTitle>
            <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground marker:text-border">
              <li>{t('consent.how1')}</li>
              <li>{t('consent.how2')}</li>
              <li>{t('consent.how3')}</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function VersionRow({ version }: { version: ConsentDocumentSummary }): ReactNode {
  const published = version.status === 'published';
  return (
    <li className="flex flex-col gap-1 border-b py-2.5 first:pt-0 last:border-0 last:pb-0">
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {t('consent.version')} {version.version}
        </span>
        <Badge variant={published ? 'default' : 'secondary'}>
          {published ? t('consent.statusPublished') : t('consent.statusArchived')}
        </Badge>
      </span>
      <span className="text-xs text-muted-foreground">{formatDate(version.publishedAt)}</span>
      {/* Özet kısaltılıyor ama TAM değer kopyalanabiliyor: bir denetimde "bu
          metin miydi" sorusu hash'ten cevaplanıyor. */}
      <button
        type="button"
        title={version.sha256}
        aria-label={t('consent.copyChecksum')}
        className="flex w-fit items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => {
          void navigator.clipboard
            .writeText(version.sha256)
            .then(() => toast.success(t('consent.checksumCopied')))
            .catch(() => undefined);
        }}
      >
        <code>sha256 {version.sha256.slice(0, 10)}…</code>
        <Copy aria-hidden="true" className="size-3" />
      </button>
    </li>
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
      <Tabs defaultValue="kvkk" className="gap-5">
        <TabsList>
          <TabsTrigger value="kvkk">{t('consent.tab.kvkk')}</TabsTrigger>
          <TabsTrigger value="treatments">{t('consent.tab.treatments')}</TabsTrigger>
        </TabsList>
        <TabsContent value="kvkk">
          <ConsentEditor />
        </TabsContent>
        <TabsContent value="treatments" className="max-w-5xl">
          <PageHeader
            title={t('consent.templates.title')}
            description={t('consent.templates.subtitle')}
          />
          <TreatmentTemplates />
        </TabsContent>
      </Tabs>
    </PermissionGate>
  );
}
