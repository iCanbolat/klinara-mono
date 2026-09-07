'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CUSTOMER_GENDERS, CUSTOMER_SOURCES, type Customer } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
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
import { Field, FieldSelect } from '@/components/ui/field';
import { errorFor, toFormErrors, type FormErrors } from '@/lib/forms/field-errors';

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

interface Draft {
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
  gender: string;
  source: string;
  addressLine: string;
  city: string;
}

function toDraft(customer: Customer | null): Draft {
  return {
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    birthDate: customer?.birthDate ?? '',
    gender: customer?.gender ?? '',
    source: customer?.source ?? '',
    addressLine: customer?.addressLine ?? '',
    city: customer?.city ?? '',
  };
}

/**
 * Müşteri oluşturma / düzenleme.
 *
 * ---------------------------------------------------------------------------
 * BOŞ ALAN: OLUŞTURMADA ATLANIYOR, DÜZENLEMEDE `null`
 * ---------------------------------------------------------------------------
 * `CreateCustomerDto` isteğe bağlı alanları `?: string` olarak alıyor;
 * `UpdateCustomerDto` ise `?: string | null`. Fark anlamlı: oluştururken boş
 * bir alanı GÖNDERMEMEK "değer yok" demek, düzenlerken `null` GÖNDERMEK
 * "değeri sil" demek. Boş dize göndermek ikisinde de yanlış — sunucuda `''`
 * bir değer olarak saklanır ve telefon alanı boş dizeyle E.164
 * doğrulamasından geçemez.
 *
 * İstemci tarafı doğrulama YOK (bkz. `lib/forms/field-errors.ts`): sunucunun
 * `class-validator` kuralları tek otorite ve hatalar `fieldErrors` üzerinden
 * alanlara düşüyor.
 */
export function CustomerFormDialog({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` = oluşturma. */
  customer: Customer | null;
  onClose: () => void;
  onSaved: (saved: Customer) => void;
}): ReactNode {
  const [draft, setDraft] = useState<Draft>(() => toDraft(customer));
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await Promise.resolve();
      setDraft(toDraft(customer));
      setErrors(NO_ERRORS);
      setBusy(false);
    })();
  }, [open, customer]);

  function set<K extends keyof Draft>(key: K, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const optional = (value: string): string | null | undefined => {
        const trimmed = value.trim();
        if (trimmed !== '') return trimmed;
        // Oluşturmada ATLA, düzenlemede SİL.
        return customer === null ? undefined : null;
      };

      const body = {
        fullName: draft.fullName.trim(),
        phone: optional(draft.phone),
        email: optional(draft.email),
        birthDate: optional(draft.birthDate),
        // `gender` ve `source` enum: `null` kabul etmiyorlar, yalnız
        // atlanabiliyorlar. Boş seçim = alanı gönderme.
        ...(draft.gender === '' ? {} : { gender: draft.gender }),
        ...(draft.source === '' ? {} : { source: draft.source }),
        addressLine: optional(draft.addressLine),
        city: optional(draft.city),
      };

      const saved =
        customer === null
          ? await api.post<Customer>('customers', body)
          : await api.patch<Customer>(`customers/${customer.id}`, body);

      toast.success(customer === null ? t('customers.created') : t('customers.updated'));
      onSaved(saved);
    } catch (caught) {
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{customer === null ? t('customers.new') : customer.fullName}</DialogTitle>
          <DialogDescription className="sr-only">{t('customers.title')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('customers.name')}
            value={draft.fullName}
            disabled={busy}
            error={errorFor(errors, 'fullName')}
            onChange={(event) => set('fullName', event.target.value)}
          />
          <Field
            label={t('customers.phone')}
            value={draft.phone}
            disabled={busy}
            error={errorFor(errors, 'phone')}
            onChange={(event) => set('phone', event.target.value)}
          />
          <Field
            label={t('customers.email')}
            type="email"
            value={draft.email}
            disabled={busy}
            error={errorFor(errors, 'email')}
            onChange={(event) => set('email', event.target.value)}
          />
          <Field
            label="Doğum tarihi"
            type="date"
            value={draft.birthDate}
            disabled={busy}
            error={errorFor(errors, 'birthDate')}
            onChange={(event) => set('birthDate', event.target.value)}
          />
          <FieldSelect
            label="Cinsiyet"
            value={draft.gender}
            disabled={busy}
            error={errorFor(errors, 'gender')}
            onChange={(event) => set('gender', event.target.value)}
          >
            <option value="">—</option>
            {CUSTOMER_GENDERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </FieldSelect>
          <FieldSelect
            label={t('customers.source')}
            value={draft.source}
            disabled={busy}
            error={errorFor(errors, 'source')}
            onChange={(event) => set('source', event.target.value)}
          >
            <option value="">—</option>
            {CUSTOMER_SOURCES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </FieldSelect>
          <Field
            label="Adres"
            value={draft.addressLine}
            disabled={busy}
            error={errorFor(errors, 'addressLine')}
            onChange={(event) => set('addressLine', event.target.value)}
          />
          <Field
            label="Şehir"
            value={draft.city}
            disabled={busy}
            error={errorFor(errors, 'city')}
            onChange={(event) => set('city', event.target.value)}
          />
        </div>

        {errors.message !== null ? (
          <Alert tone="danger">
            <span role="alert">{errors.message}</span>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('calendar.detail.close')}
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={busy || draft.fullName.trim() === ''}
            onClick={() => void submit()}
          >
            {t('customers.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
