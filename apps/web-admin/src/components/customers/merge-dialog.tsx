'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Customer } from '@klinara/shared';
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
import { CustomerPicker } from '@/components/pickers/customer-picker';
import type { ComboboxOption } from '@/components/ui/combobox';

/**
 * Mükerrer kayıt birleştirme.
 *
 * ---------------------------------------------------------------------------
 * YAZARAK ONAY — `ConfirmButton` YETMEZ
 * ---------------------------------------------------------------------------
 * Bu işlem GERİ ALINAMAZ ve iki müşterinin randevu, paket ve not
 * geçmişini kalıcı olarak birleştiriyor. Yanlış kaydı seçmek, iki farklı
 * insanın tıbbi geçmişini tek karta toplamak demek.
 *
 * `ConfirmButton` (tek tıklık onay) bu ağırlıkta bir işlem için yeterli
 * değil: bir modal açılıp "Onayla"ya basmak refleks hâline gelir. Kullanıcı
 * bir KELİME YAZMAK zorunda — düşünmeden yapılamayacak tek onay biçimi.
 *
 * ⚠️ YÖN: yoldaki kimlik HAYATTA KALIR, seçilen kayıt ARŞİVLENİR. Arayüz
 * bunu açıkça yazıyor; ters anlaşılırsa kullanıcı yanlış kaydı yok eder.
 */
export function MergeDialog({
  open,
  survivor,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Hayatta kalacak kayıt — açık olan kart. */
  survivor: Customer;
  onClose: () => void;
  onDone: () => void;
}): ReactNode {
  const [source, setSource] = useState<ComboboxOption | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const word = t('customers.merge.confirmWord');
  const ready = source !== null && confirmation.trim() === word && source.id !== survivor.id;

  async function submit(): Promise<void> {
    if (!ready || source === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`customers/${survivor.id}/merge`, { sourceCustomerId: source.id });
      toast.success(t('customers.merge.done'));
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
          <DialogTitle>{t('customers.merge.title')}</DialogTitle>
          <DialogDescription>{t('customers.merge.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Alert tone="warn">
            <strong>{survivor.fullName}</strong> hayatta kalır; aşağıda seçilen kayıt arşivlenir.
          </Alert>

          <CustomerPicker
            value={source}
            onSelect={setSource}
            canCreate={false}
            error={
              source !== null && source.id === survivor.id
                ? 'Bir kaydı kendisiyle birleştiremezsiniz.'
                : undefined
            }
          />

          <Field
            label={t('customers.merge.confirmLabel')}
            value={confirmation}
            disabled={busy || source === null}
            onChange={(event) => setConfirmation(event.target.value)}
          />

          {error !== null ? (
            <Alert tone="danger">
              <span role="alert">{error}</span>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('calendar.detail.close')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={busy}
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {t('customers.merge.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
