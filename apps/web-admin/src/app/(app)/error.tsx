'use client';

import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { t } from '@/i18n/tr';

/**
 * Rota sınırı hatası.
 *
 * `error` nesnesinin mesajı KULLANICIYA GÖSTERİLMİYOR: üretimde Next zaten onu
 * maskeliyor, geliştirmede ise iç ayrıntı (dosya yolu, sorgu) sızdırabiliyor.
 * Ayrıntı konsolda ve sunucu günlüğünde duruyor.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }): ReactNode {
  return (
    <EmptyState
      icon={TriangleAlert}
      title={t('state.errorTitle')}
      message={t('state.errorBody')}
      action={{ label: t('common.retry'), onClick: reset }}
    />
  );
}
