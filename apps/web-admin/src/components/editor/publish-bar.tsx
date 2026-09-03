'use client';

import { useState, type ReactNode } from 'react';
import type { BookingPage, RevisionSummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-4 py-2">
      <div className="text-sm text-ink-soft">
        {page !== null ? (
          <>
            <span className="font-medium text-ink">{t(`page.status.${page.status}` as 'page.status.draft')}</span>
            {draft !== null ? <span> · sürüm {draft.revisionNumber}</span> : null}
            {page.hasUnpublishedChanges ? <span> · {t('page.unpublishedChanges')}</span> : null}
          </>
        ) : null}
      </div>

      {readOnly ? (
        <span className="text-sm text-ink-soft">{t('editor.readOnly')}</span>
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

      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('editor.publish')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-line bg-card p-5">
            <h2 className="mb-2 text-base font-semibold">{t('editor.publish')}</h2>
            <Alert tone="info" className="mb-4">
              {t('editor.publishStaleness')}
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  onPublish();
                }}
              >
                {t('editor.publish')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
