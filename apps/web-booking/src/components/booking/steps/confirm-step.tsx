'use client';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import type { Step } from '../machine';
import type { SelectionSummary } from '../selection';
import { SummaryRows } from '../summary-panel';
import { t } from '@/i18n/tr';

export function ConfirmStep({
  selection,
  steps,
  onEdit,
  fullName,
  email,
  onFullNameChange,
  onEmailChange,
  submitting,
  onSubmit,
}: {
  selection: SelectionSummary;
  steps: Step[];
  onEdit: (step: Step) => void;
  fullName: string;
  email: string;
  onFullNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* `lg:` üstünde sağdaki sabit panel zaten aynı özeti gösteriyor;
          ikisini birden çizmek ekranın yarısını tekrara ayırmak olurdu. */}
      <div
        className="border border-line bg-raised px-4 py-2 lg:hidden"
        style={{ borderRadius: 'var(--brand-radius)' }}
      >
        <SummaryRows selection={selection} steps={steps} onEdit={onEdit} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fullName" label={t('booking.confirm.fullName')}>
          <Input
            id="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(event) => {
              onFullNameChange(event.target.value);
            }}
            // Gönderim sırasında KİLİTLİ: sunucunun idempotency kaydı
            // gövdeyi de hash'liyor, aynı anahtarla farklı gövde çakışır.
            disabled={submitting}
          />
        </Field>
        <Field id="email" label={`${t('booking.confirm.email')} (${t('common.optional')})`}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              onEmailChange(event.target.value);
            }}
            disabled={submitting}
          />
        </Field>
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full"
        loading={submitting}
        disabled={fullName.trim().length < 2}
        onClick={onSubmit}
      >
        {submitting ? t('booking.confirm.submitting') : t('booking.confirm.submit')}
      </Button>
    </div>
  );
}
