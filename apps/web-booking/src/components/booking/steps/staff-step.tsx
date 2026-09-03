'use client';

import { Users } from 'lucide-react';
import type { StaffOption } from '@klinara/shared';
import { Monogram, OptionGroup, RadioOption } from '@/components/ui/option-card';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n/tr';

/**
 * "Fark etmez" bir SEÇENEK, seçimsizlik değil — bu yüzden radio grubunda kendi
 * değeri var. Radix boş dizeyi "hiç seçilmemiş" sayıyor; sentinel olmasaydı
 * kullanıcı bilinçli tercihini geri alamazdı.
 */
const ANY = '__any__';

export function StaffStep({
  staff,
  value,
  onChange,
  loading,
}: {
  staff: StaffOption[];
  value: string | null;
  onChange: (staffRef: string | null) => void;
  loading: boolean;
}) {
  return (
    <OptionGroup
      label={t('booking.step.staff')}
      value={value ?? ANY}
      onValueChange={(next) => {
        onChange(next === ANY ? null : next);
      }}
    >
      <RadioOption
        value={ANY}
        index={0}
        leading={<Users className="size-5 opacity-60" aria-hidden />}
        title={t('booking.staff.any')}
        description={t('booking.staff.anyHint')}
      />

      {loading
        ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[74px]" />)
        : staff.map((option, index) => (
            <RadioOption
              key={option.staffRef}
              value={option.staffRef}
              index={index + 1}
              leading={<Monogram name={option.name} />}
              title={option.name}
              description={option.title}
            />
          ))}
    </OptionGroup>
  );
}
