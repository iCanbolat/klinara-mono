import type { PublicBookingSettings, PublicSlot } from '@klinara/shared';
import type { StoredHold } from '@/lib/hold-storage';
import type { UserFacingError } from '@/lib/errors';

export const ALL_STEPS = [
  'branch',
  'service',
  'staff',
  'datetime',
  'identity',
  'consent',
  'confirm',
  'done',
] as const;
export type Step = (typeof ALL_STEPS)[number];

/**
 * Adım dizisi AYARLARDAN türetiliyor, gizlenerek değil.
 *
 * `showStaffSelection` kapalıyken `staff` adımı diziden ÇIKIYOR: gizlemek,
 * "İleri" tuşunun görünmeyen bir adıma gitmesi ve adım göstergesinin yanlış
 * saymasıyla sonuçlanırdı. Aynı sebeple URL'den gelen `staffRef` de yok
 * sayılıyor — akış tek bir gerçeğe göre çalışmalı.
 */
export function stepsFor(settings: PublicBookingSettings): Step[] {
  return ALL_STEPS.filter((step) => {
    if (step === 'staff') return settings.showStaffSelection;
    if (step === 'identity') return settings.requireOtp;
    if (step === 'consent') return settings.requiredConsents.length > 0;
    return true;
  });
}

export interface BookingState {
  step: Step;
  branchId: string | null;
  serviceIds: string[];
  staffRef: string | null;
  /** `YYYY-MM-DD`, şube saat diliminde. */
  date: string | null;
  slots: PublicSlot[];
  slotsLoading: boolean;
  selectedSlotToken: string | null;
  hold: StoredHold | null;
  error: UserFacingError | null;
  /** Gönderim sırasında form kilitli — idempotency gövde hash'ini korumak için. */
  submitting: boolean;
  otpSent: boolean;
  /**
   * OTP kilidi SANİYE olarak tutuluyor, bitiş ANI olarak değil.
   *
   * `Date.now()` ile bir bitiş damgası üretmek, render yolunda saf olmayan bir
   * çağrı demekti (React Compiler kuralı bunu yakalıyor) ve gerçek bir kazancı
   * da yoktu: ekranda gösterilen şey "şu kadar saniye sonra tekrar deneyin".
   */
  otpLockedSeconds: number | null;
  consents: Record<string, boolean>;
  result: { appointmentId: string; manageToken: string } | null;
}

export type BookingAction =
  | { type: 'goto'; step: Step }
  | { type: 'selectBranch'; branchId: string }
  | { type: 'toggleService'; serviceId: string }
  | { type: 'selectStaff'; staffRef: string | null }
  | { type: 'selectDate'; date: string }
  | { type: 'slotsLoading' }
  | { type: 'slotsLoaded'; slots: PublicSlot[] }
  | { type: 'selectSlot'; slotToken: string }
  | { type: 'holdCreated'; hold: StoredHold }
  | { type: 'restore'; hold: StoredHold }
  | { type: 'holdCleared' }
  | { type: 'otpSent'; phone: string }
  | { type: 'otpVerified' }
  | { type: 'otpLocked'; seconds: number }
  | { type: 'toggleConsent'; kind: string }
  | { type: 'submitting' }
  | { type: 'submitted'; result: { appointmentId: string; manageToken: string } }
  | { type: 'error'; error: UserFacingError | null };

export function initialState(overrides: Partial<BookingState> = {}): BookingState {
  return {
    step: 'branch',
    branchId: null,
    serviceIds: [],
    staffRef: null,
    date: null,
    slots: [],
    slotsLoading: false,
    selectedSlotToken: null,
    hold: null,
    error: null,
    submitting: false,
    otpSent: false,
    otpLockedSeconds: null,
    consents: {},
    result: null,
    ...overrides,
  };
}

export function reducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case 'goto':
      return { ...state, step: action.step, error: null };

    case 'selectBranch':
      // Şube değişince hizmet, personel ve slotlar geçersiz: başka şubede
      // aynı hizmet olmayabilir, personel yetkinliği şube kapsamlı olabilir.
      return {
        ...state,
        branchId: action.branchId,
        serviceIds: [],
        staffRef: null,
        slots: [],
        selectedSlotToken: null,
        error: null,
      };

    case 'toggleService': {
      const has = state.serviceIds.includes(action.serviceId);
      return {
        ...state,
        serviceIds: has
          ? state.serviceIds.filter((id) => id !== action.serviceId)
          : [...state.serviceIds, action.serviceId],
        // Hizmet kümesi değişince yetkin personel kümesi de değişir.
        staffRef: null,
        slots: [],
        selectedSlotToken: null,
        error: null,
      };
    }

    case 'selectStaff':
      return { ...state, staffRef: action.staffRef, slots: [], selectedSlotToken: null };

    case 'selectDate':
      return { ...state, date: action.date, slots: [], selectedSlotToken: null };

    case 'slotsLoading':
      return { ...state, slotsLoading: true };

    case 'slotsLoaded':
      return { ...state, slots: action.slots, slotsLoading: false };

    case 'selectSlot':
      return { ...state, selectedSlotToken: action.slotToken, error: null };

    case 'holdCreated':
      return { ...state, hold: action.hold, error: null };

    case 'restore':
      // Sayfa yenilemesi: tutma yaşıyorsa seçim bağlamı da onunla geri gelir.
      return {
        ...state,
        hold: action.hold,
        branchId: action.hold.branchId,
        serviceIds: action.hold.serviceIds,
        staffRef: action.hold.staffRef,
        step: 'datetime',
        error: null,
      };

    case 'holdCleared':
      // Hold ölünce OTP doğrulaması da ölür: doğrulama hold'a bağlı
      // (`slot_holds.otp_verified_at`), ortalıkta ayrı bir token dolaşmıyor.
      return {
        ...state,
        hold: null,
        selectedSlotToken: null,
        otpSent: false,
        submitting: false,
        step: 'datetime',
      };

    case 'otpSent':
      return {
        ...state,
        otpSent: true,
        otpLockedSeconds: null,
        error: null,
        hold: state.hold === null ? null : { ...state.hold, phone: action.phone },
      };

    case 'otpVerified':
      return {
        ...state,
        error: null,
        hold: state.hold === null ? null : { ...state.hold, otpVerified: true },
      };

    case 'otpLocked':
      return { ...state, otpLockedSeconds: action.seconds };

    case 'toggleConsent':
      return {
        ...state,
        consents: { ...state.consents, [action.kind]: !(state.consents[action.kind] ?? false) },
        error: null,
      };

    case 'submitting':
      return { ...state, submitting: true, error: null };

    case 'submitted':
      return { ...state, submitting: false, result: action.result, step: 'done' };

    case 'error':
      return { ...state, submitting: false, error: action.error };
  }
}

/** Bir adımdan ileri gidilebilir mi. */
export function canAdvance(state: BookingState, settings: PublicBookingSettings): boolean {
  switch (state.step) {
    case 'branch':
      return state.branchId !== null;
    case 'service':
      return state.serviceIds.length > 0;
    case 'staff':
      return true; // "Fark etmez" geçerli bir seçim.
    case 'datetime':
      return state.hold !== null;
    case 'identity':
      return state.hold?.otpVerified === true || !settings.requireOtp;
    case 'consent':
      return settings.requiredConsents
        .filter((consent) => consent.required)
        .every((consent) => state.consents[consent.kind] === true);
    default:
      return true;
  }
}

export function nextStep(steps: Step[], current: Step): Step {
  const index = steps.indexOf(current);
  return steps[Math.min(index + 1, steps.length - 1)] ?? current;
}

export function previousStep(steps: Step[], current: Step): Step {
  const index = steps.indexOf(current);
  return steps[Math.max(index - 1, 0)] ?? current;
}
