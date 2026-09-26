'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarOff, CalendarX2, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import type { AvailabilityDaysResponse, AvailabilityResponse } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { FieldDate } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { addDays, dayRange, formatTime, rangeFrom, todayKey, type DayKey } from '@/lib/calendar/date';
import {
  SLOT_PERIOD_LABEL,
  emptyDayNotice,
  groupSlots,
  openDayNote,
  unavailableDayLabel,
} from '@/lib/calendar/availability';

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
 * ---------------------------------------------------------------------------
 * BOŞ LİSTENİN NEDENİ SUNUCUDAN
 * ---------------------------------------------------------------------------
 * Yanıttaki `days` günün durumunu taşıyor (tatil / kapalı / geçmiş / pencere
 * dışı / açık). Tatil gününde "uygun saat yok" demek, kullanıcıya personel
 * değiştirmeyi denetiyordu; artık gün kuralı açıkça söyleniyor ve tarih
 * seçici o günleri `GET /availability/days` ile baştan kapatıyor.
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
  const [result, setResult] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Tarih seçicide görünen ay (`YYYY-MM-01`); `null` = seçici hiç açılmadı. */
  const [month, setMonth] = useState<DayKey | null>(null);
  const [monthDays, setMonthDays] = useState<AvailabilityDaysResponse['days']>([]);

  useEffect(() => {
    if (serviceKey === '') return;

    const controller = new AbortController();
    void (async () => {
      setResult(null);
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

        const response = await api.get<AvailabilityResponse>(`availability?${params.toString()}`, {
          signal: controller.signal,
          branchId,
        });
        if (controller.signal.aborted) return;
        setResult(response);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();

    return () => controller.abort();
  }, [branchId, day, timezone, staffProfileId, serviceKey]);

  // Ay görünümü: dış günler dahil ~6 hafta. Hata sessiz — işaretleme bir
  // kolaylık; gelmezse seçici yine çalışır, gün seçilince yanıt nedeni söyler.
  useEffect(() => {
    if (month === null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const range = rangeFrom(addDays(month, -7), 49, timezone);
        const params = new URLSearchParams({ branchId, from: range.from, to: range.to });
        const response = await api.get<AvailabilityDaysResponse>(
          `availability/days?${params.toString()}`,
          { signal: controller.signal, branchId },
        );
        if (!controller.signal.aborted) setMonthDays(response.days);
      } catch {
        // bkz. yukarı
      }
    })();
    return () => controller.abort();
  }, [branchId, month, timezone]);

  const unavailable = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of monthDays) {
      const label = unavailableDayLabel(entry);
      if (label !== null) map.set(entry.date, label);
    }
    return map;
  }, [monthDays]);

  if (serviceIds.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('calendar.create.pickSlotFirst')}</p>;
  }

  const dayInfo = result?.days?.find((entry) => entry.date === day);
  const slots = result?.slots ?? null;
  const note = openDayNote(dayInfo);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FieldDate
            label={t('calendar.reschedule.pickDay')}
            value={day}
            disabled={disabled}
            unavailable={unavailable}
            onMonthChange={setMonth}
            onChange={(next) => {
              if (next !== '') setDay(next);
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Önceki gün"
          disabled={disabled}
          onClick={() => setDay(addDays(day, -1))}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Sonraki gün"
          disabled={disabled}
          onClick={() => setDay(addDays(day, 1))}
        >
          <ChevronRight />
        </Button>
      </div>

      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {note !== null ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          {note}
        </p>
      ) : null}

      {slots === null && error === null ? (
        <div
          className="grid grid-cols-4 gap-2 sm:grid-cols-6"
          aria-busy="true"
          aria-label={t('calendar.loading')}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="h-10 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : null}

      {slots !== null && slots.length === 0 ? <EmptyDay day={dayInfo} onNext={() => setDay(addDays(day, 1))} /> : null}

      {slots !== null && slots.length > 0 ? (
        <div className="flex flex-col gap-4" role="group" aria-label={t('calendar.create.slot')}>
          {groupSlots(slots, timezone).map((group) => (
            <section key={group.period} className="flex flex-col gap-2">
              <h4 className="flex items-baseline gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {SLOT_PERIOD_LABEL[group.period]}
                <span className="font-normal normal-case tabular-nums">· {group.slots.length}</span>
              </h4>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {group.slots.map((slot) => {
                  const selected = value === slot.startsAt;
                  return (
                    <button
                      key={slot.startsAt}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => onSelect(slot.startsAt)}
                      className={cn(
                        'h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-card hover:border-primary/50 hover:bg-accent',
                        disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {formatTime(slot.startsAt, timezone)}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyDay({
  day,
  onNext,
}: {
  day: Parameters<typeof emptyDayNotice>[0];
  onNext: () => void;
}): ReactNode {
  const notice = emptyDayNotice(day);
  const Icon = notice.tone === 'info' ? CalendarOff : CalendarX2;
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center"
    >
      <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{notice.title}</p>
      <p className="text-sm text-muted-foreground">{notice.detail}</p>
      {day?.status === 'beyond_window' ? null : (
        <Button type="button" variant="outline" size="sm" onClick={onNext}>
          Sonraki gün
          <ChevronRight />
        </Button>
      )}
    </div>
  );
}
