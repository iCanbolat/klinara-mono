'use client';

import type { PublicCategory } from '@klinara/shared';
import { CheckboxOption } from '@/components/ui/option-card';
import { formatMinor } from '../slot-grouping';
import { t } from '@/i18n/tr';

export function ServiceStep({
  categories,
  selectedIds,
  onToggle,
  showPrices,
  currency,
  totalMinutes,
  totalMinor,
}: {
  categories: PublicCategory[];
  selectedIds: string[];
  onToggle: (serviceId: string) => void;
  showPrices: boolean;
  currency: string;
  totalMinutes: number;
  totalMinor: number | null;
}) {
  let index = 0;

  return (
    <div className="space-y-6">
      {categories.map((category) => (
        <div key={category.id}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide uppercase opacity-55">
            {category.name}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {category.services.map((service) => (
              <CheckboxOption
                key={service.id}
                index={index++}
                checked={selectedIds.includes(service.id)}
                onCheckedChange={() => {
                  onToggle(service.id);
                }}
                title={service.name}
                description={service.description}
                meta={
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="opacity-70">
                      {service.durationMinutes} {t('common.minutes')}
                    </span>
                    {/* `showPrices` kapalıyken sunucu anahtarı hiç göndermiyor. */}
                    {showPrices && service.priceMinor !== undefined && (
                      <span>{formatMinor(service.priceMinor, service.currency ?? currency)}</span>
                    )}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      ))}

      {selectedIds.length > 0 && (
        <p className="animate-fade-in text-sm opacity-70">
          {t('booking.service.selected', { count: selectedIds.length })} · {totalMinutes}{' '}
          {t('common.minutes')}
          {totalMinor !== null && <> · {formatMinor(totalMinor, currency)}</>}
        </p>
      )}
    </div>
  );
}
