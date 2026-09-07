'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Appointment } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';

/**
 * Randevu iptali.
 *
 * `If-Match` GÖNDERİLMİYOR çünkü uç istemiyor. Bu bir eksiklik gibi görünse
 * de burada zararsız: iptal idempotent bir sonuca varıyor (zaten iptal
 * edilmiş bir randevuyu iptal etmek `INVALID_STATUS_TRANSITION` veriyor,
 * veri bozmuyor). Asıl sorun iptalden SONRA — bkz. `appointment-sheet.tsx`
 * içindeki A2 telafisi.
 *
 * Sebep alanı isteğe bağlı ama uyarı zorunlu: iptal geri alınamaz ve
 * `resource_bookings` satırı `active=false` olduğu için slot serbest kalır.
 */
export function CancelDialog({
  open,
  appointment,
  onClose,
  onDone,
}: {
  open: boolean;
  appointment: Appointment;
  onClose: () => void;
  onDone: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      await api.post(`appointments/${appointment.id}/cancel`, {
        ...(trimmed === '' ? {} : { reason: trimmed }),
      });
      toast.success(t('calendar.cancelled'));
      onDone();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('calendar.cancel.title')}</DialogTitle>
          <DialogDescription>{t('calendar.cancel.warning')}</DialogDescription>
        </DialogHeader>

        <Field
          label={t('calendar.cancel.reason')}
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />

        {error !== null ? (
          <Alert tone="danger">
            <span role="alert">{error}</span>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('calendar.detail.close')}
          </Button>
          <Button type="button" variant="danger" loading={busy} onClick={() => void submit()}>
            {t('calendar.cancel.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
