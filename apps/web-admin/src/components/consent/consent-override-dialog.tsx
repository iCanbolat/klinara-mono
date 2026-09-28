'use client';

import { useState, type ReactNode } from 'react';
import { CONSENT_LIMITS } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldTextarea } from '@/components/ui/field';

/**
 * İşlem onamı eksikken işleme geçiş: yumuşak uyarı.
 *
 * Varsayılan eylem "Onam al" — diyalog personeli önce imza almaya
 * yönlendiriyor. Gerekçeyle devam etmek mümkün ama gerekçe BOŞ olamaz ve
 * randevu geçmişine düşer.
 */
export function ConsentOverrideDialog({
  open,
  missingTitles,
  busy,
  error,
  canCollect,
  onCollect,
  onConfirm,
  onClose,
}: {
  open: boolean;
  missingTitles: string[];
  busy: boolean;
  error: string | null;
  canCollect: boolean;
  onCollect: () => void;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('consent.override.title')}</DialogTitle>
          <DialogDescription>
            {t('consent.override.body', { items: missingTitles.join(', ') })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <FieldTextarea
            label={t('consent.override.reason')}
            placeholder={t('consent.override.reasonPlaceholder')}
            rows={3}
            maxLength={CONSENT_LIMITS.overrideReason}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
          {error !== null ? (
            <Alert tone="danger">
              <span role="alert">{error}</span>
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            loading={busy}
            disabled={busy || trimmed === ''}
            onClick={() => onConfirm(trimmed)}
          >
            {t('consent.override.confirm')}
          </Button>
          {canCollect ? (
            <Button type="button" disabled={busy} onClick={onCollect}>
              {t('consent.override.collectInstead')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
