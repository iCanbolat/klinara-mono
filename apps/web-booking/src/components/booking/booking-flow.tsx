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
import { useHoldCountdown } from '@/hooks/use-hold-countdown';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { toE164 } from '@/components/ui/phone-input';
import { SlotPicker } from './slot-picker';
import { Stepper } from './stepper';
import { HoldBanner } from './hold-banner';
import { NavBar } from './nav-bar';
import { SummaryBar, SummaryPanel } from './summary-panel';
import { buildSelection } from './selection';
import { BranchStep } from './steps/branch-step';
import { ServiceStep } from './steps/service-step';
import { StaffStep } from './steps/staff-step';
import { IdentityStep } from './steps/identity-step';
import { ConsentStep } from './steps/consent-step';
import { ConfirmStep } from './steps/confirm-step';
import { DoneStep } from './steps/done-step';
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

/** Kart başlıkları adım makinesinden değil buradan geliyor; makine saf kalıyor. */
const HEADINGS: Record<Step, { title: string; subtitle?: string }> = {
  branch: { title: t('booking.branch.title'), subtitle: t('booking.branch.subtitle') },
  service: { title: t('booking.service.title'), subtitle: t('booking.service.subtitle') },
  staff: { title: t('booking.staff.title'), subtitle: t('booking.staff.subtitle') },
  datetime: { title: t('booking.datetime.title'), subtitle: t('booking.datetime.subtitle') },
  identity: { title: t('booking.identity.title'), subtitle: t('booking.identity.subtitle') },
  consent: { title: t('booking.consent.title'), subtitle: t('booking.consent.subtitle') },
  confirm: { title: t('booking.confirm.title'), subtitle: t('booking.confirm.subtitle') },
  done: { title: '' },
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
  /**
   * Personel listesi tek bir state'te SORGU ANAHTARIYLA birlikte duruyor ve
   * "yükleniyor" ayrı bir bayrak değil TÜREV (`result.key !== staffKey`).
   * `slot-picker` ile aynı kalıp: efekt gövdesinde senkron `setState` yok,
   * dolayısıyla ardışık render dalgası da yok.
   */
  const [staffResult, setStaffResult] = useState<{ key: string; options: StaffOption[] } | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  /** Ulusal haneler; sunucuya `+90…` olarak gidiyor (bkz. `phone-input.tsx`). */
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  /** Hold POST'u süren slot — ızgara kilitli, o çip spinner'da. */
  const [pendingSlotToken, setPendingSlotToken] = useState<string | null>(null);
  /**
   * Geçiş YÖNÜ animasyon için. `dispatch` çağrılarının hepsini sarmalamak
   * yerine yalnız adım değiştiren yollar yönü bildiriyor; kalanlar ileri
   * varsayılıyor.
   */
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  function goto(step: Step): void {
    setDirection(steps.indexOf(step) < steps.indexOf(state.step) ? 'back' : 'forward');
    dispatch({ type: 'goto', step });
  }

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
    // `holdCleared` kullanıcıyı saat adımına GERİ götürüyor; geçiş de öyle
    // görünmeli.
    setDirection('back');
    dispatch({ type: 'holdCleared' });
    setReloadKey((key) => key + 1);
  }

  const holdToken = state.hold?.holdToken;
  const { secondsLeft, isExpiring } = useHoldCountdown(state.hold?.expiresAt ?? null, () => {
    releaseHold(holdToken);
  });

  // Personel listesi: adım açıkken ve seçim kümesi hazırken.
  const staffKey =
    site.settings.showStaffSelection && state.branchId !== null && state.serviceIds.length > 0
      ? `${state.branchId}|${state.serviceIds.join(',')}`
      : null;

  useEffect(() => {
    if (staffKey === null) return;

    const controller = new AbortController();
    const [branchId = '', serviceIds = ''] = staffKey.split('|');
    const params = new URLSearchParams({ branchId, serviceIds });
    bookingApi
      .get<StaffOption[]>(`sites/${site.slug}/staff?${params.toString()}`, {
        signal: controller.signal,
      })
      .then((options) => {
        setStaffResult({ key: staffKey, options });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStaffResult({ key: staffKey, options: [] });
      });
    return () => {
      controller.abort();
    };
  }, [site.slug, staffKey]);

  const staffLoading = staffKey !== null && staffResult?.key !== staffKey;
  const staff = staffLoading ? [] : (staffResult?.options ?? []);

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
    if (pendingSlotToken !== null) return;
    setPendingSlotToken(slot.slotToken);
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
    } finally {
      setPendingSlotToken(null);
    }
  }

  async function sendOtp(): Promise<void> {
    const e164 = toE164(phone);
    if (state.hold === null || e164 === '' || sending) return;
    setSending(true);
    try {
      await bookingApi.post(`sites/${site.slug}/holds/${state.hold.holdToken}/otp`, {
        phone: e164,
      });
      dispatch({ type: 'otpSent', phone: e164 });
    } catch (cause) {
      fail(cause);
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp(): Promise<void> {
    if (state.hold === null || verifying) return;
    setVerifying(true);
    try {
      await bookingApi.post(`sites/${site.slug}/holds/${state.hold.holdToken}/otp/verify`, {
        code: otpCode,
      });
      const verified: StoredHold = { ...state.hold, otpVerified: true, phone: toE164(phone) };
      writeHold(site.slug, verified);
      dispatch({ type: 'otpVerified' });
      setDirection('forward');
      dispatch({ type: 'goto', step: nextStep(steps, 'identity') });
    } catch (cause) {
      fail(cause);
    } finally {
      setVerifying(false);
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
  const staffName =
    staff.find((option) => option.staffRef === state.staffRef)?.name ?? null;
  const selection = buildSelection(site, categories, state, staffName);

  if (state.step === 'done' && state.result !== null) {
    return (
      <DoneStep
        manageToken={state.result.manageToken}
        selection={selection}
        startsAt={state.hold?.startsAt ?? null}
        branchPhone={branch?.phone ?? null}
      />
    );
  }

  const heading = HEADINGS[state.step];

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:px-6 lg:py-10">
      <div className="min-w-0 space-y-4">
        <Stepper steps={steps} current={state.step} onGoto={goto} />

        <SummaryBar selection={selection} steps={steps} onEdit={goto} />

        {state.hold !== null && secondsLeft !== null && (
          <HoldBanner secondsLeft={secondsLeft} isExpiring={isExpiring} />
        )}

        {state.error !== null && (
          <Alert>
            <p>{state.error.message}</p>
            {state.error.fieldErrors.length > 0 && (
              <ul className="mt-2 list-disc pl-4">
                {state.error.fieldErrors.map((field) => (
                  <li key={field.path}>{field.message}</li>
                ))}
              </ul>
            )}
            {state.error.requestId !== null && (
              <p className="mt-2 text-[11px] opacity-60">
                {t('booking.error.supportCode', { requestId: state.error.requestId })}
              </p>
            )}
          </Alert>
        )}

        {/*
          `key` adım DEĞİŞTİĞİNDE ağacı yeniden bağlıyor; animasyon böylece bir
          kütüphane olmadan her geçişte yeniden oynuyor. Yön duyarlı: "Geri"
          tuşunun gerçekten geri gittiği hareketten anlaşılmalı.
        */}
        <div
          key={state.step}
          className={direction === 'forward' ? 'animate-step-in' : 'animate-step-in-back'}
        >
          <Card>
            <CardHeader title={heading.title} subtitle={heading.subtitle} />
            <CardBody>
              {state.step === 'branch' && (
                <BranchStep
                  branches={site.branches}
                  value={state.branchId}
                  onChange={(branchId) => {
                    dispatch({ type: 'selectBranch', branchId });
                  }}
                />
              )}

              {state.step === 'service' && (
                <ServiceStep
                  categories={categories}
                  selectedIds={state.serviceIds}
                  showPrices={site.settings.showPrices}
                  currency={selection.currency}
                  totalMinutes={selection.totalMinutes}
                  totalMinor={selection.totalMinor}
                  onToggle={(serviceId) => {
                    dispatch({ type: 'toggleService', serviceId });
                  }}
                />
              )}

              {state.step === 'staff' && (
                <StaffStep
                  staff={staff}
                  loading={staffLoading}
                  value={state.staffRef}
                  onChange={(staffRef) => {
                    dispatch({ type: 'selectStaff', staffRef });
                  }}
                />
              )}

              {state.step === 'datetime' && state.branchId !== null && (
                <SlotPicker
                  query={{
                    slug: site.slug,
                    branchId: state.branchId,
                    serviceIds: state.serviceIds,
                    staffRef: state.staffRef,
                    timezone: branch?.timezone ?? site.timezone,
                  }}
                  selectedSlotToken={state.hold === null ? null : state.selectedSlotToken}
                  pendingSlotToken={pendingSlotToken}
                  maxAdvanceDays={site.settings.maxAdvanceDays}
                  reloadKey={reloadKey}
                  onSelect={(slot) => {
                    void selectSlot(slot);
                  }}
                />
              )}

              {state.step === 'identity' && (
                <IdentityStep
                  phone={phone}
                  onPhoneChange={setPhone}
                  otpSent={state.otpSent}
                  otpCode={otpCode}
                  onOtpChange={setOtpCode}
                  sending={sending}
                  verifying={verifying}
                  lockedSeconds={state.otpLockedSeconds}
                  onSend={() => {
                    void sendOtp();
                  }}
                  onVerify={() => {
                    void verifyOtp();
                  }}
                />
              )}

              {state.step === 'consent' && (
                <ConsentStep
                  consents={site.settings.requiredConsents}
                  values={state.consents}
                  highlightMissing={state.error?.recovery === 'highlight-consent'}
                  onToggle={(kind) => {
                    dispatch({ type: 'toggleConsent', kind });
                  }}
                />
              )}

              {state.step === 'confirm' && (
                <ConfirmStep
                  selection={selection}
                  steps={steps}
                  onEdit={goto}
                  fullName={fullName}
                  email={email}
                  onFullNameChange={setFullName}
                  onEmailChange={setEmail}
                  submitting={state.submitting}
                  onSubmit={() => {
                    void submit();
                  }}
                />
              )}
            </CardBody>
          </Card>
        </div>

        {state.step !== 'confirm' && (
          <NavBar
            canGoBack={steps.indexOf(state.step) > 0}
            canAdvance={canAdvance(state, site.settings)}
            // Doğrulama adımında ileri gitmenin tek yolu KODU DOĞRULAMAK.
            showNext={state.step !== 'identity'}
            onBack={() => {
              goto(previousStep(steps, state.step));
            }}
            onNext={() => {
              goto(nextStep(steps, state.step));
            }}
          />
        )}
      </div>

      <SummaryPanel selection={selection} steps={steps} onEdit={goto} />
    </div>
  );
}
