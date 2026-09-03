'use client';

import { Check, Phone } from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import type { SelectionSummary } from '../selection';
import { formatDateTime } from '../slot-grouping';
import { t } from '@/i18n/tr';

export function DoneStep({
  manageToken,
  selection,
  startsAt,
  branchPhone,
}: {
  manageToken: string;
  selection: SelectionSummary;
  /** Hold temizlendiği için saat AYRICA taşınıyor. */
  startsAt: string | null;
  branchPhone: string | null;
}) {
  return (
    <div className="mx-auto max-w-lg animate-step-in px-4 py-14 text-center sm:py-20">
      <span
        aria-hidden
        className="mx-auto flex size-16 animate-check-pop items-center justify-center rounded-full text-white"
        style={{ background: 'var(--brand-primary)' }}
      >
        <Check className="size-8" strokeWidth={3} />
      </span>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t('booking.done.title')}</h1>
      <p className="mt-3 text-sm leading-relaxed opacity-70">{t('booking.done.body')}</p>

      <Card className="mt-8 text-left">
        <CardBody className="space-y-2 text-sm">
          {startsAt !== null && (
            <p className="text-base font-semibold">
              {formatDateTime(startsAt, selection.timezone)}
            </p>
          )}
          <p className="opacity-70">{selection.services.map((s) => s.name).join(', ')}</p>
          {selection.branchName !== null && (
            <p className="opacity-70">{selection.branchName}</p>
          )}
        </CardBody>
      </Card>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <LinkButton href={`/r/${manageToken}`} size="lg">
          {t('booking.done.manage')}
        </LinkButton>
        {branchPhone !== null && (
          <LinkButton href={`tel:${branchPhone}`} size="lg" variant="outline">
            <Phone className="size-4" />
            {t('booking.done.callClinic')}
          </LinkButton>
        )}
      </div>
    </div>
  );
}
