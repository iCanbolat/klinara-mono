'use client';

import type { PublicBookingSettings } from '@klinara/shared';
import { CheckboxOption } from '@/components/ui/option-card';
import { t } from '@/i18n/tr';

export function ConsentStep({
  consents,
  values,
  onToggle,
  highlightMissing,
}: {
  consents: PublicBookingSettings['requiredConsents'];
  values: Record<string, boolean>;
  onToggle: (kind: string) => void;
  /** Sunucu `CONSENT_REQUIRED` döndüğünde eksik onamlar işaretlenir. */
  highlightMissing: boolean;
}) {
  return (
    <div className="space-y-3">
      {consents.map((consent, index) => (
        <CheckboxOption
          key={consent.kind}
          index={index}
          checked={values[consent.kind] ?? false}
          invalid={consent.required && highlightMissing && values[consent.kind] !== true}
          onCheckedChange={() => {
            onToggle(consent.kind);
          }}
          title={
            <span className="text-sm leading-relaxed font-normal">{consent.text}</span>
          }
          // Yıldız yerine rozet: uzun bir onam metninin sonuna eklenen `*`
          // kendi satırına sarıyor ve başıboş bir madde işareti gibi
          // görünüyordu.
          meta={
            consent.required ? (
              <span className="text-[11px] tracking-wide uppercase opacity-60">{t('booking.consent.required')}</span>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
