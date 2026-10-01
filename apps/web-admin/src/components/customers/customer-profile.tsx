import type { ReactNode } from 'react';
import type { Customer, CustomerGender } from '@klinara/shared';
import { t, type MessageKey } from '@/i18n/tr';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { Separator } from '@/components/ui/separator';
import { formatCalendarDay, formatDate } from '@/lib/customers/format';

export const GENDER_LABEL: Record<CustomerGender, MessageKey> = {
  female: 'customers.gender.female',
  male: 'customers.gender.male',
  other: 'customers.gender.other',
  undisclosed: 'customers.gender.undisclosed',
};

/**
 * Müşteri künyesi — kartın sol sütunu.
 *
 * Boş alan SATIRIYLA birlikte gösteriliyor ("—"): satırı gizlemek, "e-postası
 * yok" ile "bu ekranda e-posta alanı yok"u ayırt edilemez yapardı ve eksik
 * bilgiyi tamamlama ihtiyacı görünmez kalırdı.
 */
export function CustomerProfile({
  customer,
  className,
}: {
  customer: Customer;
  className?: string;
}): ReactNode {
  const address = [customer.addressLine, customer.district, customer.city, customer.postalCode]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');

  return (
    <Card className={cn('flex flex-col gap-5', className)}>
      <Section title={t('customers.profile.contact')}>
        <Row label={t('customers.phone')} value={customer.phone} numeric />
        <Row label={t('customers.email')} value={customer.email} />
        <Row label={t('customers.profile.address')} value={address === '' ? null : address} />
      </Section>

      <Separator />

      <Section title={t('customers.profile.personal')}>
        <Row
          label={t('customers.profile.birthDate')}
          value={customer.birthDate === null ? null : formatCalendarDay(customer.birthDate)}
        />
        <Row
          label={t('customers.profile.gender')}
          value={customer.gender === null ? null : t(GENDER_LABEL[customer.gender])}
        />
        <Row label={t('customers.profile.since')} value={formatDate(customer.createdAt)} />
      </Section>

      <Separator />

      <section className="flex flex-col gap-2.5">
        <h2 className="text-label text-muted-foreground">{t('customers.tags')}</h2>
        {customer.tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('customers.profile.noTags')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {customer.tags.map((tag) => (
              <li key={tag.id}>
                <Badge variant="outline" className="gap-1.5">
                  {tag.color === null ? null : (
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                  )}
                  {tag.name}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {customer.notes === null || customer.notes.trim() === '' ? null : (
        <>
          <Separator />
          <section className="flex flex-col gap-2">
            <h2 className="text-label text-muted-foreground">{t('customers.profile.remarks')}</h2>
            <p className="whitespace-pre-wrap text-sm text-foreground">{customer.notes}</p>
          </section>
        </>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label text-muted-foreground">{title}</h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string | null;
  numeric?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          value === null
            ? 'text-sm text-muted-foreground'
            : `break-words text-sm text-foreground${numeric ? ' tabular-nums' : ''}`
        }
      >
        {value ?? t('customers.profile.missing')}
      </dd>
    </div>
  );
}
