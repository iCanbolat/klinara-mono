'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n/tr';
import { FieldSelect } from '@/components/ui/field';

/** Aktif / pasif süzgeci — `isActive` taşıyan client-side listeler için. */

export type StatusFilter = 'all' | 'active' | 'inactive';

export function matchesStatus(filter: StatusFilter, isActive: boolean): boolean {
  return filter === 'all' || isActive === (filter === 'active');
}

export function StatusSelect({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}): ReactNode {
  return (
    <FieldSelect
      label={t('list.status')}
      value={value}
      onChange={(event) => onChange(event.target.value as StatusFilter)}
    >
      <option value="all">{t('list.statusAll')}</option>
      <option value="active">{t('list.statusActive')}</option>
      <option value="inactive">{t('list.statusInactive')}</option>
    </FieldSelect>
  );
}
