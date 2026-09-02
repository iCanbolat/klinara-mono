'use client';

import { useEffect, useReducer, useState } from 'react';
import type {
  HoldResponse,
  PublicCategory,
  PublicSitePayload,
  PublicSlot,
  StaffOption,
} from '@klinara/shared';
import { bookingApi } from '@/lib/booking-fetch';
import { describeError, invalidatesHold } from '@/lib/errors';
import { clearHold, readHold, writeHold, type StoredHold } from '@/lib/hold-storage';
import { newIdempotencyKey } from '@/lib/idempotency';
import { formatCountdown, useHoldCountdown } from '@/hooks/use-hold-countdown';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label } from '@/components/ui/field';
import { SlotPicker } from './slot-picker';
import {
  canAdvance,
  initialState,
  nextStep,
  previousStep,
  reducer,
  stepsFor,
  type Step,
} from './machine';
import { t } from '@/i18n/tr';

const STEP_LABEL: Record<Step, string> = {
  branch: t('booking.step.branch'),
  service: t('booking.step.service'),
  staff: t('booking.step.staff'),
  datetime: t('booking.step.datetime'),
  identity: t('booking.step.identity'),
  consent: t('booking.step.consent'),
  confirm: t('booking.step.confirm'),
  done: '',
};

export function BookingFlow({
  site,
  categories,
}: {
  site: PublicSitePayload;
  categories: PublicCategory[];
}) {
  const steps = stepsFor(site.settings);
  const [state, dispatch] = useReducer(
    reducer,
    initialState({
      branchId: site.defaultBranchId ?? site.branches[0]?.id ?? null,
      step: 'branch',
    }),
  );
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');

  // Sayfa yenilendiğinde tutulan slot kaybolmasın.
  useEffect(() => {
    const stored = readHold(site.slug);
    if (stored !== null && new Date(stored.expiresAt).getTime() > Date.now()) {
      // Tutma ile birlikte SEÇİM de geri yükleniyor ve kullanıcı doğrudan saat
      // adımına konumlanıyor: sayacı görüp şube seçme ekranında durmak,
      // kullanıcıya iki farklı gerçek anlatmak olurdu.
      dispatch({ type: 'restore', hold: stored });
    } else if (stored !== null) {
      clearHold(site.slug);
    }
  }, [site.slug]);

  /**
   * Süre dolunca: depoyu temizle, sunucuya haber ver ve saatleri TAZELE.
   *
   * `keepalive` şart — kullanıcı sekmeyi kapatırken de tutma serbest kalsın.
   * Yine de kritik değil: sunucu `expires_at`i her okumada kontrol ediyor ve
   * bir süpürme işi arkada temizliyor.
   */
  function releaseHold(token: string | undefined): void {
    clearHold(site.slug);
    if (token !== undefined) {
      void fetch(`/api/b/sites/${site.slug}/holds/${token}`, {
        method: 'DELETE',
        keepalive: true,
        credentials: 'omit',
      }).catch(() => undefined);
    }
    dispatch({ type: 'holdCleared' });
    setReloadKey((key) => key + 1);
  }

  const holdToken = state.hold?.holdToken;
  const { secondsLeft, isExpiring } = useHoldCountdown(state.hold?.expiresAt ?? null, () => {
    releaseHold(holdToken);
  });

  // Personel listesi: adım açıkken ve seçim kümesi hazırken.
  useEffect(() => {
    if (!site.settings.showStaffSelection) return;
    if (state.branchId === null || state.serviceIds.length === 0) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      branchId: state.branchId,
      serviceIds: state.serviceIds.join(','),
    });
    bookingApi
      .get<StaffOption[]>(`sites/${site.slug}/staff?${params.toString()}`, {
        signal: controller.signal,
      })
      .then(setStaff)
      .catch(() => {
        setStaff([]);
      });
    return () => {
      controller.abort();
    };
  }, [site.slug, site.settings.showStaffSelection, state.branchId, state.serviceIds]);

  function fail(cause: unknown): void {
    const described = describeError(cause);
    if (invalidatesHold(cause)) {
      releaseHold(state.hold?.holdToken);
    }
    if (described.recovery === 'refresh-slots') setReloadKey((key) => key + 1);
    if (described.recovery === 'lock-otp') {
      dispatch({ type: 'otpLocked', seconds: described.retryAfterSeconds ?? 60 });
    }
    dispatch({ type: 'error', error: described });
  }

  async function selectSlot(slot: PublicSlot): Promise<void> {
    dispatch({ type: 'selectSlot', slotToken: slot.slotToken });
    try {
      // Eski tutma varsa önce bırakılıyor: sunucu aynı istemciden en fazla iki
      // aktif tutmaya izin veriyor ve saat değiştiren bir kullanıcı o tavana
      // kendi kendine çarpmamalı.
      if (state.hold !== null) {
        await bookingApi
          .delete(`sites/${site.slug}/holds/${state.hold.holdToken}`)
          .catch(() => undefined);
      }
      const response = await bookingApi.post<HoldResponse>(`sites/${site.slug}/holds`, {
        slotToken: slot.slotToken,
      });
      const stored: StoredHold = {
        ...response,
        branchId: state.branchId ?? '',
        serviceIds: state.serviceIds,
        staffRef: state.staffRef,
        phone: null,
        // Anahtar TUTMA ile birlikte doğuyor ve tutma yaşadıkça sabit kalıyor.
        idempotencyKey: newIdempotencyKey(),
      };
      writeHold(site.slug, stored);
      dispatch({ type: 'holdCreated', hold: stored });
    } catch (cause) {
      fail(cause);
    }
  }

  async function sendOtp(): Promise<void> {
    if (state.hold === null) return;
    try {
      await bookingApi.post(`sites/${site.slug}/holds/${state.hold.holdToken}/otp`, { phone });
      dispatch({ type: 'otpSent', phone });
    } catch (cause) {
      fail(cause);
    }
  }

  async function verifyOtp(): Promise<void> {
    if (state.hold === null) return;
    try {
      await bookingApi.post(`sites/${site.slug}/holds/${state.hold.holdToken}/otp/verify`, {
        code: otpCode,
      });
      const verified: StoredHold = { ...state.hold, otpVerified: true, phone };
      writeHold(site.slug, verified);
      dispatch({ type: 'otpVerified' });
      dispatch({ type: 'goto', step: nextStep(steps, 'identity') });
    } catch (cause) {
      fail(cause);
    }
  }

  async function submit(): Promise<void> {
    if (state.hold === null || state.submitting) return;
    dispatch({ type: 'submitting' });
    try {
      const consents = site.settings.requiredConsents
        .filter((consent) => state.consents[consent.kind] === true)
        .map((consent) => ({ kind: consent.kind, textSha256: consent.textSha256 }));

      const result = await bookingApi.post<{ appointmentId: string; manageToken: string }>(
        `sites/${site.slug}/appointments`,
        {
          holdToken: state.hold.holdToken,
          fullName,
          ...(email === '' ? {} : { email }),
          consents,
        },
        { idempotencyKey: state.hold.idempotencyKey },
      );
      clearHold(site.slug);
      dispatch({ type: 'submitted', result });
    } catch (cause) {
      fail(cause);
    }
  }

  const branch = site.branches.find((item) => item.id === state.branchId);
  const services = categories.flatMap((category) => category.services);
  const selected = services.filter((service) => state.serviceIds.includes(service.id));

  if (state.step === 'done' && state.result !== null) {
    return (
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">{t('booking.done.title')}</h1>
        <p className="mt-3 text-sm opacity-80">
          Randevu bilgileriniz telefonunuza gönderildi. Randevunuzu aşağıdaki bağlantıdan
          görüntüleyebilir, değiştirebilir ya da iptal edebilirsiniz.
        </p>
        <a
          className="mt-6 inline-block underline underline-offset-4"
          href={`/r/${state.result.manageToken}`}
        >
          Randevumu görüntüle
        </a>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-6 py-10">
      <ol className="mb-8 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
        {steps
          .filter((step) => step !== 'done')
          .map((step) => (
            <li
              key={step}
              aria-current={step === state.step ? 'step' : undefined}
              className={step === state.step ? 'font-semibold opacity-100' : undefined}
            >
              {STEP_LABEL[step]}
            </li>
          ))}
      </ol>

      {state.hold !== null && secondsLeft !== null && (
        <Alert tone={isExpiring ? 'error' : 'info'} className="mb-6">
          {isExpiring ? t('booking.hold.expiring') : t('booking.hold.remaining')}:{' '}
          <strong>{formatCountdown(secondsLeft)}</strong>
        </Alert>
      )}

      {state.error !== null && (
        <Alert className="mb-6">
          <p>{state.error.message}</p>
          {state.error.fieldErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-4">
              {state.error.fieldErrors.map((field) => (
                <li key={field.path}>{field.message}</li>
              ))}
            </ul>
          )}
          {state.error.requestId !== null && (
            <p className="mt-2 text-[11px] opacity-60">Destek kodu: {state.error.requestId}</p>
          )}
        </Alert>
      )}

      <div className="space-y-6">
        {state.step === 'branch' && (
          <fieldset className="space-y-3">
            <legend className="text-lg font-semibold">Şube seçin</legend>
            {site.branches.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant={item.id === state.branchId ? 'primary' : 'outline'}
                className="w-full justify-start"
                onClick={() => {
                  dispatch({ type: 'selectBranch', branchId: item.id });
                }}
              >
                <span className="text-left">
                  {item.name}
                  {item.address !== null && (
                    <span className="block text-xs font-normal opacity-75">{item.address}</span>
                  )}
                </span>
              </Button>
            ))}
          </fieldset>
        )}

        {state.step === 'service' && (
          <fieldset className="space-y-4">
            <legend className="text-lg font-semibold">Hizmet seçin</legend>
            {categories.map((category) => (
              <div key={category.id}>
                <h3 className="text-sm font-medium opacity-70">{category.name}</h3>
                <div className="mt-2 space-y-2">
                  {category.services.map((service) => (
                    <Button
                      key={service.id}
                      type="button"
                      variant={state.serviceIds.includes(service.id) ? 'primary' : 'outline'}
                      className="w-full justify-between"
                      onClick={() => {
                        dispatch({ type: 'toggleService', serviceId: service.id });
                      }}
                    >
                      <span>{service.name}</span>
                      <span className="text-xs font-normal">
                        {service.durationMinutes} {t('common.minutes')}
                        {/* `showPrices` kapalıyken sunucu anahtarı hiç göndermiyor. */}
                        {site.settings.showPrices && service.priceMinor !== undefined && (
                          <> · {formatMinor(service.priceMinor, service.currency ?? site.currency)}</>
                        )}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        )}

        {state.step === 'staff' && (
          <fieldset className="space-y-3">
            <legend className="text-lg font-semibold">Uygulayıcı seçin</legend>
            <Button
              type="button"
              variant={state.staffRef === null ? 'primary' : 'outline'}
              className="w-full justify-start"
              onClick={() => {
                dispatch({ type: 'selectStaff', staffRef: null });
              }}
            >
              {t('booking.staff.any')}
            </Button>
            {staff.map((option) => (
              <Button
                key={option.staffRef}
                type="button"
                variant={state.staffRef === option.staffRef ? 'primary' : 'outline'}
                className="w-full justify-start"
                onClick={() => {
                  dispatch({ type: 'selectStaff', staffRef: option.staffRef });
                }}
              >
                <span className="text-left">
                  {option.name}
                  {option.title !== null && (
                    <span className="block text-xs font-normal opacity-75">{option.title}</span>
                  )}
                </span>
              </Button>
            ))}
          </fieldset>
        )}

        {state.step === 'datetime' && state.branchId !== null && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t('booking.step.datetime')}</h2>
            <SlotPicker
              query={{
                slug: site.slug,
                branchId: state.branchId,
                serviceIds: state.serviceIds,
                staffRef: state.staffRef,
                timezone: branch?.timezone ?? site.timezone,
              }}
              selectedSlotToken={state.hold === null ? null : state.selectedSlotToken}
              reloadKey={reloadKey}
              onSelect={(slot) => {
                void selectSlot(slot);
              }}
            />
          </div>
        )}

        {state.step === 'identity' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Telefon doğrulama</h2>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefon numarası</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0532 123 45 67"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
                disabled={state.otpSent}
              />
            </div>

            {!state.otpSent ? (
              <Button
                type="button"
                disabled={phone.trim().length < 7}
                onClick={() => {
                  void sendOtp();
                }}
              >
                Doğrulama kodu gönder
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="otp">{t('booking.otp.label')}</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={otpCode}
                    onChange={(event) => {
                      setOtpCode(event.target.value.replace(/\D/g, ''));
                    }}
                    disabled={state.otpLockedSeconds !== null}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={otpCode.length < 4 || state.otpLockedSeconds !== null}
                    onClick={() => {
                      void verifyOtp();
                    }}
                  >
                    Doğrula
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setOtpCode('');
                      void sendOtp();
                    }}
                  >
                    Kodu tekrar gönder
                  </Button>
                </div>
                {state.otpLockedSeconds !== null && (
                  <p className="text-xs opacity-70">
                    {state.otpLockedSeconds} saniye sonra yeni bir kod isteyebilirsiniz.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {state.step === 'consent' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Onaylar</h2>
            {site.settings.requiredConsents.map((consent) => (
              <Checkbox
                key={consent.kind}
                id={`consent-${consent.kind}`}
                checked={state.consents[consent.kind] ?? false}
                invalid={
                  consent.required &&
                  state.error?.recovery === 'highlight-consent' &&
                  state.consents[consent.kind] !== true
                }
                onCheckedChange={() => {
                  dispatch({ type: 'toggleConsent', kind: consent.kind });
                }}
              >
                {consent.text}
                {consent.required && <span aria-hidden> *</span>}
              </Checkbox>
            ))}
          </div>
        )}

        {state.step === 'confirm' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Bilgileriniz</h2>
            <div className="space-y-2">
              <Label htmlFor="fullName">Ad soyad</Label>
              <Input
                id="fullName"
                autoComplete="name"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value);
                }}
                // Gönderim sırasında KİLİTLİ: sunucunun idempotency kaydı
                // gövdeyi de hash'liyor, aynı anahtarla farklı gövde çakışır.
                disabled={state.submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-posta (isteğe bağlı)</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                disabled={state.submitting}
              />
            </div>

            <dl className="border-t border-black/10 pt-4 text-sm">
              <div className="flex justify-between py-1">
                <dt className="opacity-70">Şube</dt>
                <dd>{branch?.name}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="opacity-70">Hizmet</dt>
                <dd>{selected.map((service) => service.name).join(', ')}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="opacity-70">Saat</dt>
                <dd>
                  {state.hold === null
                    ? '—'
                    : formatDateTime(state.hold.startsAt, branch?.timezone ?? site.timezone)}
                </dd>
              </div>
            </dl>

            <Button
              type="button"
              className="w-full"
              disabled={state.submitting || fullName.trim().length < 2}
              onClick={() => {
                void submit();
              }}
            >
              {state.submitting ? 'Gönderiliyor…' : 'Randevuyu oluştur'}
            </Button>
          </div>
        )}
      </div>

      {state.step !== 'confirm' && (
        <div className="mt-8 flex justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={steps.indexOf(state.step) === 0}
            onClick={() => {
              dispatch({ type: 'goto', step: previousStep(steps, state.step) });
            }}
          >
            {t('common.back')}
          </Button>
          {state.step !== 'identity' && (
            <Button
              type="button"
              disabled={!canAdvance(state, site.settings)}
              onClick={() => {
                dispatch({ type: 'goto', step: nextStep(steps, state.step) });
              }}
            >
              {t('common.continue')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

/**
 * Saat ŞUBENİN saat diliminde gösteriliyor, ziyaretçininkinde değil.
 *
 * Metinden regex'le saat ayıklamak cazip ama kırılgan: sunucu bir uçta zonlu
 * (`+03:00`), başka bir uçta UTC (`Z`) dönerse aynı slot iki farklı saat gibi
 * görünür. `Intl` ile şube saat dilimine çevirmek her iki biçimde de doğru
 * sonucu veriyor ve yurt dışından bakan bir ziyaretçiye kendi saatini
 * göstermiyor — randevu kliniğin saatinde.
 */
function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
