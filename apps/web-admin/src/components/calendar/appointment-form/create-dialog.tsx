'use client';

import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type Appointment, type Service, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
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
import { FieldTextarea } from '@/components/ui/field';
import type { ComboboxOption } from '@/components/ui/combobox';
import { CustomerPicker } from '@/components/pickers/customer-picker';
import { toFormErrors, type FormErrors } from '@/lib/forms/field-errors';
import { readSlotConflict, type SlotConflict } from '@/lib/calendar/conflict';
import { formatTime } from '@/lib/calendar/date';
import { ServiceRows } from './service-rows';
import { SlotPicker } from './slot-picker';
import { canQueryAvailability, canSubmit, initialState, reduce, toCreateBody } from './state';

const NO_ERRORS: FormErrors = { message: null, fields: {}, requestId: null };

/**
 * Randevu oluşturma.
 *
 * ---------------------------------------------------------------------------
 * `Idempotency-Key`İN PROJEDEKİ İLK GERÇEK ÇAĞRI YERİ
 * ---------------------------------------------------------------------------
 * `lib/api/client.ts` bu seçeneği Faz 11'den beri taşıyordu ama hiç kullanan
 * yoktu. Buradaki iş: onay düğmesine çift tıklamanın TEK randevu üretmesi.
 *
 * Anahtar durum makinesinde (`state.ts`) tutuluyor ve gövdeyi değiştiren her
 * adımda yenileniyor — sunucu gövdeyi de hash'lediği için aynı anahtarla
 * farklı gövde `IDEMPOTENCY_CONFLICT` verirdi.
 *
 * Gönderim sırasında form KİLİTLENİYOR (`busy`): kullanıcı başarısız bir
 * denemeden sonra alanı değiştirip aynı anahtarla yeniden gönderemesin.
 */
export function CreateAppointmentDialog({
  open,
  branchId,
  timezone,
  services,
  staff,
  onClose,
  onCreated,
}: {
  open: boolean;
  branchId: string;
  timezone: string;
  services: readonly Service[];
  staff: readonly StaffProfile[];
  onClose: () => void;
  onCreated: () => void;
}): ReactNode {
  const { permissions } = useSession();
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [customer, setCustomer] = useState<ComboboxOption | null>(null);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [conflict, setConflict] = useState<SlotConflict | null>(null);
  const [busy, setBusy] = useState(false);

  // Diyalog her açılışta TEMİZ başlıyor: önceki denemenin müşterisi ve
  // hatası ekranda kalsaydı kullanıcı hangi randevuyu oluşturduğunu
  // karıştırırdı.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      await Promise.resolve();
      dispatch({ type: 'reset' });
      setCustomer(null);
      setErrors(NO_ERRORS);
      setConflict(null);
      setBusy(false);
    })();
  }, [open]);

  const serviceIds = state.rows.flatMap((row) => (row.serviceId === null ? [] : [row.serviceId]));
  const staffIds = new Set(state.rows.map((row) => row.staffProfileId));
  const singleStaff = staffIds.size === 1 ? (state.rows[0]?.staffProfileId ?? null) : null;

  async function submit(): Promise<void> {
    const body = toCreateBody(state, branchId);
    if (body === null) return;

    setBusy(true);
    setErrors(NO_ERRORS);
    setConflict(null);
    try {
      await api.post<Appointment>('appointments', body, {
        idempotencyKey: state.idempotencyKey,
        branchId,
      });
      toast.success(t('calendar.create.created'));
      onCreated();
      onClose();
    } catch (caught) {
      // Çakışma bir HATA DEĞİL, randevu almanın normal bir sonucu: iki
      // resepsiyon aynı slota aynı anda yazdı. Doğru yanıt hata metni değil,
      // sunucunun zaten hesapladığı ALTERNATİF SAATLER.
      const slotConflict = readSlotConflict(caught);
      if (slotConflict !== null) {
        setConflict(slotConflict);
        // Seçili slot artık geçersiz; düşürülüyor ki kullanıcı aynı saati
        // ikinci kez göndermesin.
        dispatch({ type: 'slot', startsAt: null });
        return;
      }
      setErrors(toFormErrors(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('calendar.create.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('calendar.create.title')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <CustomerPicker
            value={customer}
            error={errors.fields['customerId']}
            canCreate={permissions.includes(PERMISSIONS.CUSTOMER_WRITE)}
            onSelect={(option) => {
              setCustomer(option);
              dispatch({ type: 'customer', customerId: option?.id ?? null });
            }}
          />

          <ServiceRows
            rows={state.rows}
            services={services}
            staff={staff}
            branchId={branchId}
            errors={errors}
            disabled={busy}
            dispatch={dispatch}
          />

          {canQueryAvailability(state) ? (
            <SlotPicker
              branchId={branchId}
              serviceIds={serviceIds}
              staffProfileId={singleStaff}
              timezone={timezone}
              value={state.startsAt}
              disabled={busy}
              onSelect={(startsAt) => {
                dispatch({ type: 'slot', startsAt });
                setConflict(null);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('calendar.create.pickSlotFirst')}</p>
          )}

          <FieldTextarea
            label={t('calendar.create.notes')}
            rows={2}
            value={state.notes}
            disabled={busy}
            onChange={(event) => dispatch({ type: 'notes', notes: event.target.value })}
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
                        onClick={() => {
                          dispatch({ type: 'slot', startsAt: suggestion.startsAt });
                          setConflict(null);
                        }}
                      >
                        {formatTime(suggestion.startsAt, timezone)}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                // Öneri üretimi sunucuda `.catch(() => [])` ile korunuyor, yani
                // boş gelebilir. Bu bir son değil, bir dallanma: slot düştüğü
                // için `SlotPicker` uygunluğu zaten yeniden sorguluyor.
                <p className="text-sm">{t('calendar.conflict.noSuggestions')}</p>
              )}
            </Alert>
          ) : null}

          {errors.message !== null ? (
            <Alert tone="danger">
              <span role="alert">{errors.message}</span>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('calendar.detail.close')}
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={!canSubmit(state) || busy}
            onClick={() => void submit()}
          >
            {t('calendar.create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
