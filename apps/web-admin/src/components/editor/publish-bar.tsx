'use client';

import { History } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { BookingPage, RevisionSummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Kaydet / yayınla çubuğu.
 *
 * BAYATLIK METNİ BURADA ve dürüst olmak zorunda: purge worker'ı bir
 * HIZLANDIRICI, bir garanti değil (`QUEUE_ENABLED=false` iken sessizce dönüyor
 * ve web erişilemezse geri çekilerek deniyor). `s-maxage=300` her hâlükârda
 * bayatlığı beş dakikayla sınırlıyor. "Anında yayında" demek, kullanıcının
 * sayfayı yenileyip eski içeriği görmesi ve bize güvenmemesi demekti.
 */
export function PublishBar({
  page,
  draft,
  dirty,
  saving,
  publishing,
  readOnly,
  onSave,
  onPublish,
}: {
  page: BookingPage | null;
  draft: RevisionSummary | null;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  readOnly: boolean;
  onSave: () => void;
  onPublish: () => void;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);

  const status = page?.status ?? null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {page !== null && status !== null ? (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                status === 'published'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', status === 'published' ? 'bg-primary' : 'bg-muted-foreground')}
              />
              {t(`page.status.${status}` as 'page.status.draft')}
            </span>
            {draft !== null ? (
              <span className="text-muted-foreground">
                {t('editor.revision', { number: draft.revisionNumber })}
                {' · '}
                {t('editor.savedAt', { time: TIME.format(new Date(draft.createdAt)) })}
              </span>
            ) : null}
            {dirty ? (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                {t('editor.unsaved')}
              </span>
            ) : page.hasUnpublishedChanges ? (
              <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">
                {t('page.unpublishedChanges')}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/icerik/surumler">
            <History aria-hidden="true" className="size-4" />
            {t('editor.revisions')}
          </Link>
        </Button>
        {readOnly ? (
          <span className="text-sm text-muted-foreground">{t('editor.readOnly')}</span>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={saving}
              disabled={!dirty}
              onClick={onSave}
              title={t('editor.saveShortcut')}
            >
              {t('common.save')}
            </Button>
            <Button size="sm" loading={publishing} onClick={() => setConfirming(true)}>
              {t('editor.publish')}
            </Button>
          </>
        )}
      </div>

      {/*
        Yayınlama onayı Radix `AlertDialog` ile: yıkıcı olmayan ama GERİ ALINMAZ
        bir eylem, kullanıcı bir yere kaçmadan onaylamalı. Odak tuzağı, Escape
        ve gövde kaydırma kilidi kütüphaneden geliyor — elle yazılmış modalda
        üçü de yoktu.
      */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.publish')}</AlertDialogTitle>
            <AlertDialogDescription>{t('editor.publishStaleness')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onPublish}>{t('editor.publish')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const TIME = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
