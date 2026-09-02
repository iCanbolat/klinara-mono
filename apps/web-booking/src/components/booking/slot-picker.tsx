'use client';

import { useEffect, useState } from 'react';
import type { PublicSlot } from '@klinara/shared';
import { bookingApi } from '@/lib/booking-fetch';
import { describeError, type UserFacingError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { t } from '@/i18n/tr';

export interface SlotQuery {
  slug: string;
  branchId: string;
  serviceIds: string[];
  staffRef: string | null;
  timezone: string;
}

/**
 * Gün seçimi + uygun saat ızgarası.
 *
 * 11.2 ile 11.3 (erteleme) arasında PAYLAŞILIYOR: erteleme "iptal + yeni
 * randevu" değil, aynı kaydın taşınması ve kullanıcı açısından ikisi de aynı
 * seçim. İki kopya olsaydı `min_lead` sınırındaki davranış bir gün ayrışırdı.
 *
 * Uygunluk çağrısı TARAYICIDAN yapılıyor (RSC'den değil): uç IP bazlı hız
 * sınırına tabi ve 15 saniye cache'li — sunucudan çağrılsaydı tüm ziyaretçiler
 * tek sayaca çökerdi.
 */
export function SlotPicker({
  query,
  selectedSlotToken,
  onSelect,
  reloadKey = 0,
}: {
  query: SlotQuery;
  selectedSlotToken: string | null;
  onSelect: (slot: PublicSlot) => void;
  reloadKey?: number;
}) {
  const [date, setDate] = useState<string>(() => todayIso(query.timezone));

  /**
   * Sorgunun kimliği. Sonuç bu anahtarla birlikte saklandığı için "yükleniyor"
   * ayrı bir state değil TÜREV: `result.key !== requestKey`. Böylece state
   * yalnız asenkron callback'lerde yazılıyor ve efekt gövdesinde senkron
   * `setState` (dolayısıyla ardışık render dalgası) hiç olmuyor.
   */
  const params = new URLSearchParams({
    branchId: query.branchId,
    serviceIds: query.serviceIds.join(','),
    from: `${date}T00:00:00`,
    to: `${date}T23:59:59`,
  });
  if (query.staffRef !== null) params.set('staffRef', query.staffRef);
  const path = `sites/${query.slug}/availability?${params.toString()}`;
  const requestKey = `${path}#${reloadKey}`;

  const [result, setResult] = useState<{
    key: string;
    slots: PublicSlot[];
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
        setResult({ key: requestKey, slots: response.slots, error: null });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, slots: [], error: describeError(cause) });
      });

    return () => {
      controller.abort();
    };
  }, [path, requestKey, query.serviceIds.length]);

  const loading = result === null || result.key !== requestKey;
  const slots = loading ? [] : result.slots;
  const error = loading ? null : result.error;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium" htmlFor="booking-date">
          Tarih
        </label>
        <input
          id="booking-date"
          type="date"
          value={date}
          min={todayIso(query.timezone)}
          onChange={(event) => {
            setDate(event.target.value);
          }}
          className="h-11 border border-black/15 bg-white px-3"
          style={{ borderRadius: 'var(--brand-radius)' }}
        />
      </div>

      {error !== null && <Alert>{error.message}</Alert>}

      {query.serviceIds.length === 0 ? (
        <p className="py-6 text-sm opacity-70">Önce hizmet seçin.</p>
      ) : loading ? (
        <p className="py-6 text-sm opacity-70">{t('common.loading')}</p>
      ) : slots.length === 0 ? (
        <p className="py-6 text-sm opacity-70">{t('booking.slot.empty')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {slots.map((slot) => {
            const selected = slot.slotToken === selectedSlotToken;
            return (
              <li key={slot.slotToken}>
                <Button
                  type="button"
                  variant={selected ? 'primary' : 'outline'}
                  size="sm"
                  className="w-full flex-col gap-0 py-2"
                  aria-pressed={selected}
                  onClick={() => {
                    onSelect(slot);
                  }}
                >
                  <span className="text-sm font-medium">
                    {formatTime(slot.startsAt, query.timezone)}
                  </span>
                  {slot.staffName !== undefined && (
                    <span className="text-[11px] font-normal opacity-75">{slot.staffName}</span>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Saat ŞUBENİN saat diliminde — ziyaretçinin cihaz saatinde değil.
 *
 * Randevu kliniğin duvar saatinde gerçekleşiyor; yurt dışından bakan biri
 * "09:00" görmeli, kendi saatiyle "07:00" değil.
 */
function formatTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function todayIso(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
