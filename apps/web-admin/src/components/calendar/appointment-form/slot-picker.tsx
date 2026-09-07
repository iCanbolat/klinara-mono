'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { AvailabilityResponse } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { dayRange, formatTime, todayKey, type DayKey } from '@/lib/calendar/date';

/**
 * Uygunluk motorundan gelen slotlar.
 *
 * ---------------------------------------------------------------------------
 * KULLANICI SAAT YAZAMAZ, SEÇER
 * ---------------------------------------------------------------------------
 * Serbest bir saat girdisi, uygunluk motorunun HİÇ ONAYLAMADIĞI bir başlangıç
 * üretir; sonucu `SLOT_CONFLICT` ya da `OUTSIDE_WORKING_HOURS` olur ve
 * kullanıcı reddedilen bir işlemi geri sarmayı öğrenir. Sürükle-bırakın 12.2
 * kapsamı dışında bırakılmasının gerekçesi de tam olarak bu.
 *
 * ⚠️ `GET /availability` HEM `?branchId=` HEM `X-Branch-Id` istiyor:
 * `@RequireBranchScope()` başlığı, DTO ise sorgu parametresini zorunlu
 * tutuyor. Yalnız birini göndermek garantili 400.
 */

export function SlotPicker({
  branchId,
  serviceIds,
  staffProfileId,
  timezone,
  value,
  disabled,
  onSelect,
}: {
  branchId: string;
  /** Sıra ÖNEMLİ: sunucu hizmetleri gönderilen sırayla uyguluyor. */
  serviceIds: readonly string[];
  /** Tek personelli randevuda daraltma; çok personelliyde `null`. */
  staffProfileId: string | null;
  timezone: string;
  value: string | null;
  disabled: boolean;
  onSelect: (startsAt: string) => void;
}): ReactNode {
  const [day, setDay] = useState<DayKey>(() => todayKey(timezone));
  // Dizi her render'da yeni nesne; kimliği yerine DEĞERİ izleniyor.
  // Ayıraç virgül değil `|`: hizmet kimlikleri UUID ve virgül taşımıyor ama
  // ayıracın veride geçemeyeceği bir karakter olması kuralı ucuz.
  const serviceKey = serviceIds.join('|');
  const [slots, setSlots] = useState<AvailabilityResponse['slots'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serviceKey === '') return;

    const controller = new AbortController();
    void (async () => {
      setSlots(null);
      setError(null);
      try {
        const range = dayRange(day, timezone);
        const params = new URLSearchParams({ branchId, from: range.from, to: range.to });
        // Diziyi anahtardan geri çözüyoruz: effect `serviceIds`e HİÇ
        // dokunmuyor, dolayısıyla bağımlılık listesi eksiksiz ve
        // `exhaustive-deps` susturulmak zorunda değil. Dizinin kimliği her
        // render'da değişiyor; değeri değişmiyor.
        for (const serviceId of serviceKey.split('|')) params.append('serviceIds', serviceId);
        if (staffProfileId !== null) params.set('staffProfileId', staffProfileId);

        const result = await api.get<AvailabilityResponse>(`availability?${params.toString()}`, {
          signal: controller.signal,
          branchId,
        });
        if (controller.signal.aborted) return;
        setSlots(result.slots);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();

    return () => controller.abort();
  }, [branchId, day, timezone, staffProfileId, serviceKey]);

  if (serviceIds.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('calendar.create.pickSlotFirst')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label={t('calendar.reschedule.pickDay')}
        // Ayrı bir takvim ilkeli EKLENMEDİ: yerel `<input type="date">`
        // klavye ve ekran okuyucu açısından bedava doğru, kendini
        // yerelleştiriyor ve `YYYY-MM-DD` döndürüyor — `DayKey` tipimizin
        // ta kendisi.
        type="date"
        value={day}
        disabled={disabled}
        onChange={(event) => setDay(event.target.value)}
      />

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {slots === null && error === null ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('calendar.loading')}
        </p>
      ) : null}

      {slots !== null && slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('calendar.reschedule.noSlots')}</p>
      ) : null}

      {slots !== null && slots.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('calendar.create.slot')}>
          {slots.map((slot) => (
            <button
              key={slot.startsAt}
              type="button"
              disabled={disabled}
              aria-pressed={value === slot.startsAt}
              onClick={() => onSelect(slot.startsAt)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm tabular-nums transition-colors',
                value === slot.startsAt
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input hover:bg-accent',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {formatTime(slot.startsAt, timezone)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
