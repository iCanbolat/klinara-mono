'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Appointment } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatTime } from '@/lib/calendar/date';
import { readSlotConflict, type SlotConflict } from '@/lib/calendar/conflict';
import { SlotPicker } from './appointment-form/slot-picker';

/**
 * Erteleme.
 *
 * ---------------------------------------------------------------------------
 * SÜRÜKLE-BIRAK YOK VE BU BİLİNÇLİ
 * ---------------------------------------------------------------------------
 * Bir bloğu ızgarada sürüklemek, uygunluk motorunun HİÇ ONAYLAMADIĞI bir
 * başlangıç saati üretir. Yani `SLOT_CONFLICT` ve `OUTSIDE_WORKING_HOURS`
 * istisna değil NORMAL sonuç olur ve kullanıcı, sürükleyip bıraktıktan sonra
 * reddedilen bir işlemi geri sarmayı öğrenir.
 *
 * Doğru birincil mekanizma bu: "Ertele" → `GET /availability` ile beslenen
 * slot seçici → SUNUCUNUN ONAYLADIĞI saatler arasından seçim. Klavyeyle
 * çalışıyor, ekran okuyucuya anlamlı ve `SLOT_CONFLICT.suggestions` ile
 * doğal olarak birleşiyor: yarış kaybedilirse öneriler aynı bileşende
 * render ediliyor.
 *
 * Sürükleme ileride AYNI `reschedule(id, startsAt)` çağrısının üstüne bir
 * kolaylık katmanı olarak eklenebilir — tıpkı `block-list.tsx`te klavye
 * düğmelerinin birincil, sürüklemenin ikincil olması gibi. Unutulmuş değil.
 *
 * ---------------------------------------------------------------------------
 * `If-Match` ZORUNLU
 * ---------------------------------------------------------------------------
 * Uç başlıksız istekte 428 döner. Kullanıcı 428 GÖRMEMELİ — o bir istemci
 * hatasıdır. 409 `VERSION_CONFLICT` ise gerçek bir durum: kayıt biz açtıktan
 * sonra değişmiş ve mesajı `problem.ts`ten geliyor.
 */
export function RescheduleDialog({
  open,
  appointment,
  timezone,
  onClose,
  onDone,
}: {
  open: boolean;
  appointment: Appointment;
  timezone: string;
  onClose: () => void;
  onDone: () => void;
}): ReactNode {
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SlotConflict | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await Promise.resolve();
      setStartsAt(null);
      setError(null);
      setConflict(null);
    })();
  }, [open]);

  const serviceIds = appointment.services.map((line) => line.serviceId);
  const staffIds = new Set(appointment.services.map((line) => line.staffProfileId));
  const singleStaff = staffIds.size === 1 ? (appointment.services[0]?.staffProfileId ?? null) : null;

  async function submit(target: string): Promise<void> {
    setBusy(true);
    setError(null);
    setConflict(null);
    try {
      await api.post(
        `appointments/${appointment.id}/reschedule`,
        { startsAt: target },
        { ifMatch: `W/"${String(appointment.version)}"` },
      );
      toast.success(t('calendar.rescheduled'));
      onDone();
    } catch (caught) {
      const slotConflict = readSlotConflict(caught);
      if (slotConflict !== null) {
        setConflict(slotConflict);
        setStartsAt(null);
        return;
      }
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('calendar.reschedule.title')}</DialogTitle>
          <DialogDescription>
            {formatTime(appointment.startsAt, timezone)} →{' '}
            {startsAt === null ? '—' : formatTime(startsAt, timezone)}
          </DialogDescription>
        </DialogHeader>

        <SlotPicker
          branchId={appointment.branchId}
          serviceIds={serviceIds}
          staffProfileId={singleStaff}
          timezone={timezone}
          value={startsAt}
          disabled={busy}
          onSelect={(target) => {
            setStartsAt(target);
            setConflict(null);
          }}
        />

        {conflict !== null ? (
          <Alert tone="warn" title={t('calendar.conflict.title')}>
            {conflict.suggestions.length > 0 ? (
              <>
                <p className="mb-2 text-sm">{t('calendar.conflict.pickSuggestion')}</p>
                <div className="flex flex-wrap gap-2">
                  {conflict.suggestions.map((suggestion) => (
                    <Button
                      key={suggestion.startsAt}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void submit(suggestion.startsAt)}
                    >
                      {formatTime(suggestion.startsAt, timezone)}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm">{t('calendar.conflict.noSuggestions')}</p>
            )}
          </Alert>
        ) : null}

        {error !== null ? (
          <Alert tone="danger">
            <span role="alert">{error}</span>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('calendar.detail.close')}
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={startsAt === null || busy}
            onClick={() => startsAt !== null && void submit(startsAt)}
          >
            {t('calendar.reschedule.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
