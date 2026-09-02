import { describe, it, expect } from 'vitest';
import type { PublicBookingSettings } from '@klinara/shared';
import {
  canAdvance,
  initialState,
  nextStep,
  reducer,
  stepsFor,
} from '../../src/components/booking/machine';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import type { StoredHold } from '../../src/lib/hold-storage';

const settings = (overrides: Partial<PublicBookingSettings> = {}): PublicBookingSettings => ({
  minLeadMinutes: 0,
  maxAdvanceDays: 180,
  cancelWindowHours: 24,
  holdTtlMinutes: 10,
  showStaffSelection: true,
  showPrices: true,
  allowReschedule: true,
  requireOtp: true,
  otpChannel: 'sms',
  requiredConsents: [
    { kind: 'kvkk_explicit', text: 'Metin', textSha256: 'a'.repeat(64), required: true },
    { kind: 'marketing', text: 'Metin', textSha256: 'b'.repeat(64), required: false },
  ],
  ...overrides,
});

const hold = (over: Partial<StoredHold> = {}): StoredHold => ({
  holdToken: 't',
  branchId: 'b1',
  serviceIds: ['s1'],
  staffRef: null,
  startsAt: '2026-09-07T09:00:00+03:00',
  endsAt: '2026-09-07T09:30:00+03:00',
  expiresAt: '2026-09-07T09:10:00+03:00',
  otpRequired: true,
  otpVerified: false,
  phone: null,
  idempotencyKey: 'key-1',
  ...over,
});

describe('adım dizisi ayarlardan türüyor', () => {
  it('showStaffSelection kapalıyken staff adımı DİZİDEN ÇIKIYOR', () => {
    // Gizlemek değil çıkarmak: gizli bir adım, "İleri"nin görünmeyen bir
    // ekrana gitmesi ve göstergenin yanlış sayması demekti.
    expect(stepsFor(settings())).toContain('staff');
    expect(stepsFor(settings({ showStaffSelection: false }))).not.toContain('staff');
  });

  it('requireOtp kapalıyken identity, onam yokken consent adımı yok', () => {
    expect(stepsFor(settings({ requireOtp: false }))).not.toContain('identity');
    expect(stepsFor(settings({ requiredConsents: [] }))).not.toContain('consent');
  });

  it('staff adımı atlandığında sıradaki adım datetime', () => {
    const steps = stepsFor(settings({ showStaffSelection: false }));
    expect(nextStep(steps, 'service')).toBe('datetime');
  });
});

describe('seçim değişimi türev durumu geçersiz kılıyor', () => {
  it('şube değişince hizmet, personel ve slotlar sıfırlanıyor', () => {
    // Başka şubede aynı hizmet olmayabilir ve personel yetkinliği şube
    // kapsamlı olabilir; taşımak, boş bir uygunluk ızgarasına götürürdü.
    let state = initialState({ branchId: 'b1', serviceIds: ['s1'], staffRef: 'r1' });
    state = reducer(state, { type: 'slotsLoaded', slots: [{ startsAt: 'x', endsAt: 'y', slotToken: 'z' }] });
    state = reducer(state, { type: 'selectBranch', branchId: 'b2' });

    expect(state.serviceIds).toEqual([]);
    expect(state.staffRef).toBeNull();
    expect(state.slots).toEqual([]);
  });

  it('hizmet değişince personel seçimi düşüyor', () => {
    let state = initialState({ serviceIds: ['s1'], staffRef: 'r1' });
    state = reducer(state, { type: 'toggleService', serviceId: 's2' });
    expect(state.serviceIds).toEqual(['s1', 's2']);
    expect(state.staffRef).toBeNull();
  });
});

describe('hold ömrü', () => {
  it('hold ölünce OTP doğrulaması da ölüyor ve akış datetime’a dönüyor', () => {
    // Doğrulama hold'a bağlı (`slot_holds.otp_verified_at`); ortalıkta ayrı
    // bir doğrulama token'ı dolaşmıyor, dolayısıyla taşınamaz.
    let state = initialState({
      step: 'confirm',
      hold: hold({ otpVerified: true }),
      otpSent: true,
      submitting: true,
    });
    state = reducer(state, { type: 'holdCleared' });

    expect(state.hold).toBeNull();
    expect(state.otpSent).toBe(false);
    expect(state.submitting).toBe(false);
    expect(state.step).toBe('datetime');
    expect(state.selectedSlotToken).toBeNull();
  });

  it('yeni hold YENİ idempotency anahtarı taşıyor', () => {
    const first = hold({ idempotencyKey: newIdempotencyKey() });
    const second = hold({ holdToken: 't2', idempotencyKey: newIdempotencyKey() });
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('aynı hold içindeki tekrar denemeler anahtarı DEĞİŞTİRMİYOR', () => {
    // Sunucunun idempotency kaydı "aynı niyet iki kez mi" sorusunu cevaplıyor;
    // niyet tam olarak "şu tutulan slota randevu yaz".
    let state = initialState({ hold: hold({ idempotencyKey: 'sabit' }) });
    state = reducer(state, { type: 'submitting' });
    state = reducer(state, {
      type: 'error',
      error: { message: 'ağ', recovery: 'none', retryAfterSeconds: null, requestId: null, fieldErrors: [] },
    });
    state = reducer(state, { type: 'submitting' });
    expect(state.hold?.idempotencyKey).toBe('sabit');
  });
});

describe('sayfa yenilemesi', () => {
  it('tutma geri yüklenirken SEÇİM BAĞLAMI da geri geliyor', () => {
    // Yalnız token'ı geri yüklemek, sayacı gösterip uygunluk sorgusunu
    // şubesiz/hizmetsiz bırakmak demekti: kullanıcı kendi tuttuğu slotun
    // yanında "eksik alan" hatası görürdü.
    const restored = reducer(initialState(), {
      type: 'restore',
      hold: hold({ branchId: 'b9', serviceIds: ['s7', 's8'], staffRef: 'ref9' }),
    });

    expect(restored.branchId).toBe('b9');
    expect(restored.serviceIds).toEqual(['s7', 's8']);
    expect(restored.staffRef).toBe('ref9');
    expect(restored.step).toBe('datetime');
    expect(restored.hold).not.toBeNull();
  });
});

describe('ilerleme koşulları', () => {
  it('OTP doğrulanmadan identity adımından geçilemiyor', () => {
    const state = initialState({ step: 'identity', hold: hold({ otpVerified: false }) });
    expect(canAdvance(state, settings())).toBe(false);
    expect(canAdvance({ ...state, hold: hold({ otpVerified: true }) }, settings())).toBe(true);
  });

  it('requireOtp kapalıyken identity engel değil', () => {
    const state = initialState({ step: 'identity', hold: hold() });
    expect(canAdvance(state, settings({ requireOtp: false }))).toBe(true);
  });

  it('ZORUNLU onam işaretlenmeden consent adımından geçilemiyor', () => {
    const base = initialState({ step: 'consent' });
    expect(canAdvance(base, settings())).toBe(false);

    // İsteğe bağlı onam tek başına yetmiyor.
    const optionalOnly = reducer(base, { type: 'toggleConsent', kind: 'marketing' });
    expect(canAdvance(optionalOnly, settings())).toBe(false);

    const required = reducer(optionalOnly, { type: 'toggleConsent', kind: 'kvkk_explicit' });
    expect(canAdvance(required, settings())).toBe(true);
  });

  it('hold olmadan datetime adımından geçilemiyor', () => {
    expect(canAdvance(initialState({ step: 'datetime' }), settings())).toBe(false);
    expect(canAdvance(initialState({ step: 'datetime', hold: hold() }), settings())).toBe(true);
  });
});
