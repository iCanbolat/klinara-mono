'use client';

import { useEffect, useState } from 'react';
import { CalendarX2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { PublicSlot } from '@klinara/shared';
import { bookingApi } from '@/lib/booking-fetch';
import { describeError, type UserFacingError } from '@/lib/errors';
import { cn } from '@/lib/cn';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { staggerStyle } from '@/components/ui/option-card';
import {
  addDays,
  dayKeyOf,
  daysFrom,
  formatDayNumber,
  formatDayShort,
  formatTime,
  formatWeekdayShort,
  groupByPart,
  groupSlotsByDay,
  nextAvailableDay,
  todayKey,
  type DayKey,
} from './slot-grouping';
import { t } from '@/i18n/tr';

export interface SlotQuery {
  slug: string;
  branchId: string;
  serviceIds: string[];
  staffRef: string | null;
  timezone: string;
}

const WINDOW_DAYS = 7;
const PART_LABEL = {
  morning: t('booking.datetime.morning'),
  afternoon: t('booking.datetime.afternoon'),
  evening: t('booking.datetime.evening'),
} as const;

/**
 * Gün şeridi + uygun saat ızgarası.
 *
 * 11.2 ile 11.3 (erteleme) arasında PAYLAŞILIYOR: erteleme "iptal + yeni
 * randevu" değil, aynı kaydın taşınması ve kullanıcı açısından ikisi de aynı
 * seçim. İki kopya olsaydı `min_lead` sınırındaki davranış bir gün ayrışırdı.
 *
 * Uygunluk çağrısı TARAYICIDAN yapılıyor (RSC'den değil): uç IP bazlı hız
 * sınırına tabi ve 15 saniye cache'li — sunucudan çağrılsaydı tüm ziyaretçiler
 * tek sayaca çökerdi.
 *
 * Pencere GÜNLÜK değil YEDİ GÜNLÜK: uç tek çağrıda 31 güne kadar veriyor
 * (`MAX_PUBLIC_WINDOW_DAYS`) ve hız sınırı 30 istek/dk. Gün başına bir istek
 * atmak hem sayacı hızla tüketiyordu hem de kullanıcıya hangi günün dolu
 * olduğunu ancak TIKLADIKTAN sonra söylüyordu. Tek istekle hafta geliyor, gün
 * değiştirmek ağa hiç çıkmıyor.
 */
export function SlotPicker({
  query,
  selectedSlotToken,
  onSelect,
  reloadKey = 0,
  pendingSlotToken = null,
  maxAdvanceDays = 180,
}: {
  query: SlotQuery;
  selectedSlotToken: string | null;
  onSelect: (slot: PublicSlot) => void;
  reloadKey?: number;
  /** Hold POST'u sürerken beklemede olan slot — çip spinner'a döner. */
  pendingSlotToken?: string | null;
  maxAdvanceDays?: number;
}) {
  const today = todayKey(query.timezone);
  const [windowStart, setWindowStart] = useState<DayKey>(today);
  const [selectedDay, setSelectedDay] = useState<DayKey>(today);

  const days = daysFrom(windowStart, WINDOW_DAYS);
  const lastDay = days[WINDOW_DAYS - 1] ?? windowStart;

  const params = new URLSearchParams({
    branchId: query.branchId,
    serviceIds: query.serviceIds.join(','),
    from: `${windowStart}T00:00:00`,
    to: `${lastDay}T23:59:59`,
  });
  if (query.staffRef !== null) params.set('staffRef', query.staffRef);
  const path = `sites/${query.slug}/availability?${params.toString()}`;
  const requestKey = `${path}#${reloadKey}`;

  /**
   * Sonuç bu anahtarla birlikte saklandığı için "yükleniyor" ayrı bir state
   * değil TÜREV: `result.key !== requestKey`. Böylece state yalnız asenkron
   * callback'lerde yazılıyor ve efekt gövdesinde senkron `setState` yok.
   */
  const [result, setResult] = useState<{
    key: string;
    byDay: Map<DayKey, PublicSlot[]>;
    error: UserFacingError | null;
  } | null>(null);

  useEffect(() => {
    // Hizmet seçilmeden uygunluk sorulamaz (uç `ArrayNotEmpty`). İstek atıp
    // 400 almak, kullanıcıya kendi hatası olmayan bir doğrulama mesajı
    // göstermek demekti.
    if (query.serviceIds.length === 0) return;

    const controller = new AbortController();
    bookingApi
      .get<{ slots: PublicSlot[] }>(path, { signal: controller.signal })
      .then((response) => {
        const byDay = groupSlotsByDay(response.slots, query.timezone);
        setResult({ key: requestKey, byDay, error: null });
        // Boş bir güne düşürüp kullanıcıyı gün aratmak yerine, pencerede
        // slot'u olan İLK güne konumlanıyoruz. Kullanıcının kendi seçtiği gün
        // hâlâ doluysa ona dokunulmuyor.
        setSelectedDay((current) =>
          (byDay.get(current)?.length ?? 0) > 0 && current >= windowStart && current <= lastDay
            ? current
            : (nextAvailableDay(byDay, windowStart) ?? windowStart),
        );
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, byDay: new Map(), error: describeError(cause) });
      });

    return () => {
      controller.abort();
    };
  }, [path, requestKey, query.serviceIds.length, query.timezone, windowStart, lastDay]);

  const loading = result === null || result.key !== requestKey;
  const byDay = loading ? new Map<DayKey, PublicSlot[]>() : result.byDay;
  const error = loading ? null : result.error;
  const daySlots = byDay.get(selectedDay) ?? [];
  /**
   * Uygulayıcı adı çipe YALNIZ ayırt ediciyse yazılıyor.
   *
   * Tek uygulayıcılı bir klinikte aynı ad on sekiz çipte tekrar ediyordu:
   * hiçbir seçime yardım etmeyen, yalnız saati küçülten bir gürültü.
   */
  const showStaffOnSlots =
    new Set(daySlots.map((slot) => slot.staffName).filter((name) => name !== undefined)).size > 1;
  const upcoming = loading ? null : nextAvailableDay(byDay, addDays(selectedDay, 1));

  const canGoBack = windowStart > today;
  const canGoForward = addDays(windowStart, WINDOW_DAYS) <= addDays(today, maxAdvanceDays);

  function shiftWindow(direction: -1 | 1): void {
    const next = addDays(windowStart, direction * WINDOW_DAYS);
    setWindowStart(next < today ? today : next);
  }

  if (query.serviceIds.length === 0) {
    return <p className="py-6 text-sm opacity-70">{t('booking.datetime.noService')}</p>;
  }

  return (
    <div className="space-y-5">
      {/* --- Hafta şeridi --- */}
      <div className="flex items-center gap-2">
        <WeekButton
          label={t('booking.datetime.prevWeek')}
          disabled={!canGoBack}
          onClick={() => {
            shiftWindow(-1);
          }}
        >
          <ChevronLeft className="size-4" />
        </WeekButton>

        {/* Mobilde kaydırılabilir, JS'siz: `scroll-snap` pazarlama
            carousel'ıyla aynı yaklaşım. */}
        <ul className="flex flex-1 snap-x snap-mandatory gap-1.5 overflow-x-auto pb-1 sm:gap-2">
          {days.map((day) => {
            const count = byDay.get(day)?.length ?? 0;
            const isSelected = day === selectedDay;
            const isEmpty = !loading && count === 0;
            return (
              // Mobilde çipler BÜYÜMÜYOR: `flex-1` ile yedi gün üç buçuk çipe
              // sığıyor ve şeridin bütün amacı (haftayı bir bakışta görmek)
              // kayboluyordu. Dar ekranda sabit genişlik + kaydırma.
              <li key={day} className="w-12 shrink-0 snap-start sm:w-auto sm:flex-1">
                <button
                  type="button"
                  disabled={isEmpty}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedDay(day);
                  }}
                  className={cn(
                    'flex w-full flex-col items-center gap-1 border px-1 py-2 transition-[background,border-color,transform] duration-(--dur-fast)',
                    isSelected
                      ? 'border-brand bg-brand text-white shadow-card'
                      : 'border-line bg-card hover:-translate-y-px hover:border-line-strong',
                    isEmpty && 'opacity-35',
                  )}
                  style={{ borderRadius: 'var(--brand-radius)' }}
                >
                  <span className="text-[10px] uppercase opacity-70 sm:text-[11px]">
                    {day === today ? t('booking.datetime.today') : formatWeekdayShort(day)}
                  </span>
                  <span className="text-base leading-none font-semibold">
                    {formatDayNumber(day)}
                  </span>
                  {loading ? (
                    <Skeleton className="h-1.5 w-4 rounded-full" />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'h-1.5 w-4 rounded-full transition-colors',
                        count === 0
                          ? 'bg-transparent'
                          : isSelected
                            ? 'bg-white/70'
                            : 'bg-brand',
                      )}
                    />
                  )}
                  <span className="sr-only">
                    {count === 0 ? t('booking.slot.empty') : t('booking.datetime.slotCount', { count })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <WeekButton
          label={t('booking.datetime.nextWeek')}
          disabled={!canGoForward}
          onClick={() => {
            shiftWindow(1);
          }}
        >
          <ChevronRight className="size-4" />
        </WeekButton>
      </div>

      {error !== null && <Alert>{error.message}</Alert>}

      {/* --- Saat ızgarası --- */}
      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
      ) : daySlots.length === 0 ? (
        <EmptyDay
          upcoming={upcoming}
          onJump={(day) => {
            setSelectedDay(day);
          }}
        />
      ) : (
        <div
          className={cn(
            'space-y-5',
            pendingSlotToken !== null && 'pointer-events-none opacity-60',
          )}
        >
          {groupByPart(daySlots, query.timezone).map((group) => (
            <div key={group.part}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide uppercase opacity-55">
                {PART_LABEL[group.part]}
                <span className="ml-2 font-normal opacity-70">{group.slots.length}</span>
              </h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {group.slots.map((slot, index) => {
                  const isSelected = slot.slotToken === selectedSlotToken;
                  const isPending = slot.slotToken === pendingSlotToken;
                  return (
                    <li key={slot.slotToken}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-busy={isPending || undefined}
                        onClick={() => {
                          onSelect(slot);
                        }}
                        className={cn(
                          'flex w-full animate-rise-in flex-col items-center justify-center gap-0.5 border px-1 py-2.5 text-sm transition-[background,border-color,box-shadow,transform] duration-(--dur-fast)',
                          isSelected
                            ? 'border-brand bg-brand text-white shadow-card'
                            : 'border-line bg-card hover:-translate-y-px hover:border-brand hover:shadow-lift',
                        )}
                        style={{ borderRadius: 'var(--brand-radius)', ...staggerStyle(index) }}
                      >
                        {isPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <span className="font-medium">
                            {formatTime(slot.startsAt, query.timezone)}
                          </span>
                        )}
                        {showStaffOnSlots && slot.staffName !== undefined && !isPending && (
                          <span className="max-w-full truncate text-[11px] opacity-75">
                            {slot.staffName}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeekButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center border border-line bg-card sm:size-9 transition-colors duration-(--dur-fast) hover:bg-brand-soft disabled:pointer-events-none disabled:opacity-30"
      style={{ borderRadius: 'var(--brand-radius)' }}
    >
      {children}
    </button>
  );
}

/**
 * Boş gün: yalnız "uygun saat yok" demek kullanıcıyı gün gün tıklamaya
 * bırakıyordu. Pencere verisi zaten elimizde — sonraki uygun gün EK BİR İSTEK
 * OLMADAN gösterilebilir.
 */
function EmptyDay({
  upcoming,
  onJump,
}: {
  upcoming: DayKey | null;
  onJump: (day: DayKey) => void;
}) {
  return (
    <div
      className="flex animate-fade-in flex-col items-center gap-3 border border-dashed border-line-strong px-6 py-10 text-center"
      style={{ borderRadius: 'var(--brand-radius)' }}
    >
      <CalendarX2 className="size-7 opacity-35" aria-hidden />
      <p className="text-sm opacity-70">{t('booking.slot.empty')}</p>
      {upcoming !== null && (
        <button
          type="button"
          onClick={() => {
            onJump(upcoming);
          }}
          className="text-sm font-medium text-brand-ink underline underline-offset-4"
        >
          {t('booking.datetime.nextAvailable', { day: formatDayShort(upcoming) })}
        </button>
      )}
    </div>
  );
}

export { dayKeyOf };
