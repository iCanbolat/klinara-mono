'use client';

import { useCallback, type ReactNode } from 'react';
import type { Customer } from '@klinara/shared';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/tr';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

/**
 * Müşteri arama seçicisi.
 *
 * `GET /customers/search` çıplak DİZİ döndürüyor — `{ data }` zarfı YOK.
 * Panelin geri kalanı zarflı uçlara alışkın olduğu için burada `.data`
 * beklemek kolay bir hata ve çalışma zamanında `undefined.map` olarak
 * patlardı. `clinic-api.ts` başlığı üç zarfı da adlandırıyor.
 *
 * Uç `q` için en az 2 karakter istiyor; `Combobox` varsayılanı da 2.
 */
export function CustomerPicker({
  value,
  onSelect,
  error,
  canCreate,
  onCreate,
}: {
  value: ComboboxOption | null;
  onSelect: (option: ComboboxOption | null) => void;
  error?: string | undefined;
  /**
   * `customer:write` izni. Uygulayıcı randevu AÇABİLİR ama müşteri
   * YARATAMAZ; ona "yeni müşteri" düğmesi göstermek, tıklayınca 403 yemek
   * demekti.
   */
  canCreate: boolean;
  onCreate?: (() => void) | undefined;
}): ReactNode {
  const search = useCallback(
    async (query: string, signal: AbortSignal): Promise<ComboboxOption[]> => {
      const customers = await api.get<Customer[]>(
        `customers/search?q=${encodeURIComponent(query)}`,
        { signal },
      );
      return customers.map((customer) => ({
        id: customer.id,
        label: customer.fullName,
        // Telefon ayırt edici: aynı adda iki müşteri sık, aynı telefonda iki
        // müşteri (kiracı içinde tekil) imkânsız.
        ...(customer.phone === null ? {} : { hint: customer.phone }),
      }));
    },
    [],
  );

  return (
    <Combobox
      label={t('calendar.create.customer')}
      placeholder={t('calendar.create.customerPlaceholder')}
      value={value}
      onSelect={onSelect}
      search={search}
      error={error}
      emptyAction={
        canCreate && onCreate !== undefined ? (
          <button
            type="button"
            onClick={onCreate}
            className="mt-1 text-sm text-primary underline transition-colors hover:opacity-80"
          >
            {t('calendar.create.customer')} +
          </button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('calendar.create.noCustomerWrite')}
          </p>
        )
      }
    />
  );
}
