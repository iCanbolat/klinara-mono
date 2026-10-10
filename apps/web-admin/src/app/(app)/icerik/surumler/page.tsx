'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe, History, PencilLine, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  PERMISSIONS,
  REVISION_HISTORY_LIMIT,
  type BookingPage,
  type BookingPageContent,
  type RevisionSummary,
} from '@klinara/shared';
import { ApiProblemError, api } from '@/lib/api/client';
import { describeProblem, networkError } from '@/lib/problem';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import { useSession } from '@/components/session/session-provider';
import { PermissionGate } from '@/components/session/permission-gate';
import { t } from '@/i18n/tr';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { EmptyState } from '@/components/ui/empty-state';

interface State {
  revisions: RevisionSummary[];
  /** Editörün açtığı sürüm; yayındakiyle aynı olabilir. */
  draftId: string | null;
  publishedId: string | null;
  live: boolean;
}

/**
 * Sürüm geçmişi ve geri alma.
 *
 * Liste güne göre gruplanmış bir zaman çizelgesi. Her satır iki soruyu
 * cevaplıyor: "ziyaretçi şu an hangisini görüyor" (Yayında) ve "editörü
 * açınca hangisi gelecek" (Editörde). Geri alma, sayfa yayındaysa ANINDA
 * yayına çıkıyor (bkz. `BookingPageService.rollback`) — bu yüzden onay
 * metni yayın durumuna göre değişiyor.
 */
function Revisions(): ReactNode {
  const { permissions } = useSession();
  const canManage = can(permissions, PERMISSIONS.BOOKING_PAGE_MANAGE);

  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [revisions, content, page] = await Promise.all([
        api.get<RevisionSummary[]>('booking-page/content/revisions'),
        api.get<BookingPageContent>('booking-page/content'),
        api.get<BookingPage>('booking-page'),
      ]);
      setState({
        revisions,
        draftId: content.draft?.id ?? null,
        publishedId: content.published?.id ?? null,
        live: page.status === 'published',
      });
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

  async function rollback(revision: RevisionSummary): Promise<void> {
    setBusy(revision.id);
    setError(null);
    try {
      await api.post(`booking-page/content/rollback/${revision.id}`);
      toast.success(t('revisions.restored', { number: String(revision.revisionNumber) }));
      await load();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const groups = useMemo(() => groupByDay(state?.revisions ?? []), [state]);
  const published = state?.revisions.find((revision) => revision.id === state.publishedId);
  const draft = state?.revisions.find((revision) => revision.id === state.draftId);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground">
          <Link href="/icerik">
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('revisions.back')}
          </Link>
        </Button>
        <PageHeader
          className="mb-0"
          title={t('editor.revisions')}
          description={t('revisions.description')}
        />
      </div>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {state === null ? (
        error === null ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : null
      ) : state.revisions.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={History}
            title={t('revisions.emptyTitle')}
            message={t('revisions.emptyMessage')}
            footer={
              <Button asChild variant="secondary" size="sm">
                <Link href="/icerik">{t('revisions.openEditor')}</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard
              icon={Globe}
              label={t('revisions.livePublished')}
              value={
                state.live && published !== undefined
                  ? t('revisions.number', { number: String(published.revisionNumber) })
                  : t('revisions.liveNone')
              }
              meta={state.live && published !== undefined ? formatDateTime(published.createdAt) : null}
              tone={state.live ? 'success' : 'muted'}
            />
            <SummaryCard
              icon={PencilLine}
              label={t('revisions.draftCurrent')}
              value={
                draft === undefined
                  ? '—'
                  : t('revisions.number', { number: String(draft.revisionNumber) })
              }
              meta={
                draft === undefined
                  ? null
                  : state.live && draft.id === state.publishedId
                    ? t('revisions.draftSame')
                    : formatDateTime(draft.createdAt)
              }
              tone="info"
            />
          </div>

          <section className="rounded-xl border border-border bg-card p-2 sm:p-4">
            <h2 className="sr-only">{t('editor.revisions')}</h2>
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col">
                <h3 className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </h3>
                <ol className="flex flex-col">
                  {group.revisions.map((revision) => {
                    const isLive = state.live && revision.id === state.publishedId;
                    const isDraft = revision.id === state.draftId;
                    const number = String(revision.revisionNumber);
                    return (
                      <li
                        key={revision.id}
                        className={cn(
                          'relative flex items-center gap-3 rounded-lg py-2.5 pr-2 pl-8',
                          'before:absolute before:top-0 before:bottom-0 before:left-[15px] before:w-px before:bg-border',
                          'transition-colors hover:bg-muted/50',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'absolute top-1/2 left-[11px] size-[9px] -translate-y-1/2 rounded-full ring-4 ring-card',
                            isLive ? 'bg-success' : isDraft ? 'bg-primary' : 'bg-muted-foreground/40',
                          )}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {t('revisions.number', { number })}
                            </span>
                            {isLive ? (
                              <span className="rounded-full border border-success bg-success-soft px-2 py-0.5 text-xs">
                                {t('editor.revisionCurrent')}
                              </span>
                            ) : null}
                            {isDraft ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                                {t('revisions.draft')}
                              </span>
                            ) : null}
                          </div>
                          <time
                            dateTime={revision.createdAt}
                            className="text-xs text-muted-foreground tabular-nums"
                          >
                            {formatTime(revision.createdAt)}
                          </time>
                        </div>
                        {canManage && !isDraft ? (
                          <ConfirmButton
                            size="sm"
                            variant="ghost"
                            loading={busy === revision.id}
                            disabled={busy !== null}
                            title={t('revisions.confirmTitle', { number })}
                            description={
                              state.live ? t('revisions.confirmLive') : t('revisions.confirmDraft')
                            }
                            confirmLabel={t('editor.rollback')}
                            onConfirm={() => void rollback(revision)}
                          >
                            <RotateCcw aria-hidden="true" className="size-4" />
                            <span className="hidden sm:inline">{t('editor.rollback')}</span>
                            <span className="sr-only sm:hidden">{t('editor.rollback')}</span>
                          </ConfirmButton>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </section>

          {/* Sınır GİZLENMİYOR: kullanıcı 51. sürümün nereye gittiğini sormadan
              önce cevabı görsün. */}
          <p className="text-xs text-muted-foreground">
            {t('revisions.limit', { limit: String(REVISION_HISTORY_LIMIT) })}
          </p>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  meta,
  tone,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  meta: string | null;
  tone: 'success' | 'info' | 'muted';
}): ReactNode {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          tone === 'success' && 'bg-success-soft text-success',
          tone === 'info' && 'bg-primary/10 text-primary',
          tone === 'muted' && 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
        {meta !== null ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
      </div>
    </div>
  );
}

interface DayGroup {
  key: string;
  label: string;
  revisions: RevisionSummary[];
}

/** API listeyi yeniden eskiye veriyor; sıra korunuyor, yalnız günlere bölünüyor. */
function groupByDay(revisions: readonly RevisionSummary[]): DayGroup[] {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const groups: DayGroup[] = [];
  for (const revision of revisions) {
    const date = new Date(revision.createdAt);
    const key = dayKey(date);
    let group = groups.at(-1);
    if (group?.key !== key) {
      group = {
        key,
        label:
          key === today
            ? t('revisions.today')
            : key === yesterday
              ? t('revisions.yesterday')
              : date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
        revisions: [],
      };
      groups.push(group);
    }
    group.revisions.push(revision);
  }
  return groups;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
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
