'use client';

import { useState, type ReactNode } from 'react';
import type { BookingPage, RevisionSummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
      <div className="text-sm text-muted-foreground">
        {page !== null ? (
          <>
            <span className="font-medium text-foreground">{t(`page.status.${page.status}` as 'page.status.draft')}</span>
            {draft !== null ? <span> · {t('editor.revision', { number: draft.revisionNumber })}</span> : null}
            {page.hasUnpublishedChanges ? <span> · {t('page.unpublishedChanges')}</span> : null}
          </>
        ) : null}
      </div>

      {readOnly ? (
        <span className="text-sm text-muted-foreground">{t('editor.readOnly')}</span>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={saving} disabled={!dirty} onClick={onSave}>
            {t('common.save')}
          </Button>
          <Button size="sm" loading={publishing} onClick={() => setConfirming(true)}>
            {t('editor.publish')}
          </Button>
        </div>
      )}

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
