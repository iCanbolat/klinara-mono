'use client';

import type { PublicBookingSettings } from '@klinara/shared';
import { CheckboxOption } from '@/components/ui/option-card';
import { t } from '@/i18n/tr';

/**
 * TEK zorunlu KVKK/aydınlatma onayı.
 *
 * Faz 7 daraltıldı: işlem onamı klinik içi ayrı bir akışa taşındı, pazarlama
 * ve fotoğraf kullanımı onamları MVP'den çıktı. Bu yüzden burada bir liste
 * değil, tek bir belge var.
 *
 * Metnin TAMAMI ekranda: onam, kendi metnini göstermeden alınamaz. Uzun bir
 * aydınlatma metni onay kutusunun etiketine sığmadığı için ayrı, kaydırılabilir
 * bir panelde duruyor; kutunun etiketi kısa ve okunur kalıyor.
 */
export function ConsentStep({
  consent,
  accepted,
  onToggle,
  highlightMissing,
}: {
  consent: NonNullable<PublicBookingSettings['consent']>;
  accepted: boolean;
  onToggle: () => void;
  /** Sunucu `CONSENT_REQUIRED` döndüğünde kutu işaretlenir. */
  highlightMissing: boolean;
}) {
  return (
    <div className="space-y-3">
      <div
        className="max-h-64 overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed whitespace-pre-wrap text-neutral-700"
        // Uzun metin klavyeyle de gezilebilmeli: kaydırılabilir bir bölge
        // odaklanabilir değilse klavye kullanıcısı metnin sonunu göremez.
        tabIndex={0}
        role="region"
        aria-label={t('booking.consent.documentLabel')}
      >
        {consent.text}
      </div>

      <p className="text-[11px] tracking-wide text-neutral-500 uppercase">
        {t('booking.consent.version')} {consent.version}
      </p>

      <CheckboxOption
        checked={accepted}
        invalid={highlightMissing && !accepted}
        onCheckedChange={onToggle}
        title={
          <span className="text-sm leading-relaxed font-normal">
            {t('booking.consent.checkboxLabel')}
          </span>
        }
        // Yıldız yerine rozet: uzun bir onam metninin sonuna eklenen `*` kendi
        // satırına sarıyor ve başıboş bir madde işareti gibi görünüyordu.
        meta={
          <span className="text-[11px] tracking-wide uppercase opacity-60">
            {t('booking.consent.required')}
          </span>
        }
      />
    </div>
  );
}
