import type { ReactNode } from 'react';
import Link from 'next/link';
import { Phone } from 'lucide-react';
import type { Customer } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/**
 * Müşteri defterinin kart görünümü — tablet ve telefonda tek görünüm.
 *
 * Kartın tamamı değil yalnız ad bağlantı: kartta ileride telefon/WhatsApp
 * gibi ayrı eylemler olacak ve iç içe etkileşimli öge geçersiz HTML.
 */
export function CustomerListCard({ customer }: { customer: Customer }): ReactNode {
  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Link
          href={`/musteriler/${customer.id}`}
          className="min-w-0 truncate text-body-emphasis text-primary underline-offset-2 hover:underline"
        >
          {customer.fullName}
        </Link>
        {customer.mergedIntoCustomerId !== null ? (
          <Badge variant="outline" className="text-muted-foreground">
            {t('list.inactive')}
          </Badge>
        ) : null}
      </div>

      <p className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
        <Phone aria-hidden="true" className="size-3.5" />
        {customer.phone ?? '—'}
      </p>

      {customer.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={t('customers.tags')}>
          {customer.tags.map((tag) => (
            <li key={tag.id}>
              <Badge variant="secondary">{tag.name}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
