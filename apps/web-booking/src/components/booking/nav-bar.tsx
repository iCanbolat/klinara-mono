'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/tr';

/**
 * Geri / Devam.
 *
 * Mobilde sayfanın DİBİNE sabitleniyor: uzun bir hizmet listesinin altında
 * kalan "Devam" tuşu, kullanıcının seçim yaptıktan sonra ekranı sonuna kadar
 * kaydırmasını gerektiriyordu. `env(safe-area-inset-bottom)` iPhone'un
 * göstergesinin altında kalmasını engelliyor.
 */
export function NavBar({
  canGoBack,
  canAdvance,
  showNext,
  onBack,
  onNext,
}: {
  canGoBack: boolean;
  canAdvance: boolean;
  showNext: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="sticky bottom-0 z-20 -mx-4 mt-2 flex items-center justify-between gap-3 border-t border-line bg-card/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <Button type="button" variant="ghost" disabled={!canGoBack} onClick={onBack}>
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Button>
      {showNext && (
        <Button
          type="button"
          className="min-w-32"
          disabled={!canAdvance}
          onClick={onNext}
        >
          {t('common.continue')}
          <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}
