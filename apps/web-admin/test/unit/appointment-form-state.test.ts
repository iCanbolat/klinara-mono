import { describe, expect, it } from 'vitest';
import {
  canQueryAvailability,
  canSubmit,
  initialState,
  reduce,
  toCreateBody,
  type FormState,
} from '../../src/components/calendar/appointment-form/state';

const BRANCH = 'b1111111-1111-4111-8111-111111111111';
const CUSTOMER = 'c2222222-2222-4222-8222-222222222222';
const SERVICE = 's3333333-3333-4333-8333-333333333333';
const SERVICE_2 = 's4444444-4444-4444-8444-444444444444';
const STAFF = 'p5555555-5555-4555-8555-555555555555';
const SLOT = '2026-09-07T14:00:00+03:00';

/** Gönderilebilir bir forma kadar indirger. */
function filled(): FormState {
  let state = initialState();
  state = reduce(state, { type: 'customer', customerId: CUSTOMER });
  state = reduce(state, { type: 'service', index: 0, serviceId: SERVICE });
  state = reduce(state, { type: 'staff', index: 0, staffProfileId: STAFF });
  state = reduce(state, { type: 'slot', startsAt: SLOT });
  return state;
}

describe('randevu formu durum makinesi', () => {
  it('başlangıçta bir boş hizmet satırı ve anahtar var', () => {
    const state = initialState();
    expect(state.rows).toHaveLength(1);
    expect(state.customerId).toBeNull();
    expect(state.idempotencyKey).not.toBe('');
    expect(canSubmit(state)).toBe(false);
  });

  it('hizmet değişince AŞAĞI AKIŞ sıfırlanıyor', () => {
    // Asıl risk bu: eski personel ve eski slot formda kalırsa kullanıcı
    // bambaşka bir randevu oluşturur.
    let state = filled();
    expect(state.startsAt).toBe(SLOT);

    state = reduce(state, { type: 'service', index: 0, serviceId: SERVICE_2 });

    expect(state.rows[0]?.staffProfileId).toBeNull();
    expect(state.startsAt).toBeNull();
  });

  it('PERSONEL değişince slot düşüyor', () => {
    // Uygunluk personele göre hesaplanıyor; eldeki slot artık o uygunluğun
    // ürünü değil.
    let state = filled();
    state = reduce(state, { type: 'staff', index: 0, staffProfileId: 'p9' });
    expect(state.startsAt).toBeNull();
  });

  it('hizmet EKLENİNCE de slot düşüyor', () => {
    let state = filled();
    state = reduce(state, { type: 'addRow' });
    expect(state.startsAt).toBeNull();
    expect(state.rows).toHaveLength(2);
  });

  it('SON hizmet satırı silinemez', () => {
    // Hizmetsiz randevu diye bir şey yok; boş bir form kullanıcıya ne
    // yapacağını söylemez.
    let state = initialState();
    state = reduce(state, { type: 'removeRow', index: 0 });
    expect(state.rows).toHaveLength(1);
  });

  it('gövdeyi DEĞİŞTİREN her adım anahtarı yeniliyor', () => {
    // Sunucu gövdeyi de hash'liyor: aynı anahtarla farklı gövde
    // `IDEMPOTENCY_CONFLICT` verir.
    const start = filled();
    const keys = new Set([start.idempotencyKey]);

    let state = reduce(start, { type: 'slot', startsAt: '2026-09-07T15:00:00+03:00' });
    keys.add(state.idempotencyKey);
    state = reduce(state, { type: 'notes', notes: 'ilk seans' });
    keys.add(state.idempotencyKey);
    state = reduce(state, { type: 'customer', customerId: 'c9' });
    keys.add(state.idempotencyKey);

    expect(keys.size).toBe(4);
  });

  it('uygunluk sorgusu EKSİK satır varken atılmıyor', () => {
    let state = initialState();
    expect(canQueryAvailability(state)).toBe(false);

    state = reduce(state, { type: 'service', index: 0, serviceId: SERVICE });
    expect(canQueryAvailability(state)).toBe(false);

    state = reduce(state, { type: 'staff', index: 0, staffProfileId: STAFF });
    expect(canQueryAvailability(state)).toBe(true);

    // İkinci satır eklenince yine eksik.
    state = reduce(state, { type: 'addRow' });
    expect(canQueryAvailability(state)).toBe(false);
  });

  it('canSubmit müşteri ve slot olmadan false', () => {
    let state = filled();
    expect(canSubmit(state)).toBe(true);

    state = reduce(state, { type: 'customer', customerId: null });
    expect(canSubmit(state)).toBe(false);

    state = reduce(filled(), { type: 'slot', startsAt: null });
    expect(canSubmit(state)).toBe(false);
  });

  it('gövde doğru şekilde kuruluyor', () => {
    const body = toCreateBody(filled(), BRANCH);
    expect(body).toEqual({
      branchId: BRANCH,
      customerId: CUSTOMER,
      startsAt: SLOT,
      services: [{ serviceId: SERVICE, staffProfileId: STAFF }],
    });
  });

  it('BOŞ not gövdeye girmiyor', () => {
    // `''` ile "not yok" aynı şey değil; sunucuda boş dize bir not olarak
    // saklanırdı.
    let state = reduce(filled(), { type: 'notes', notes: '   ' });
    expect(toCreateBody(state, BRANCH)).not.toHaveProperty('notes');

    state = reduce(state, { type: 'notes', notes: '  ilk seans  ' });
    expect(toCreateBody(state, BRANCH)?.notes).toBe('ilk seans');
  });

  it('gönderilemeyen formda gövde NULL', () => {
    // Kısmi gövde kurup sunucudan 400 beklemek yerine çağıranı düğmeyi
    // etkisiz tutmaya zorluyor.
    expect(toCreateBody(initialState(), BRANCH)).toBeNull();
  });

  it('çok hizmetli randevuda sıra KORUNUYOR', () => {
    // Sunucu hizmetleri GÖNDERİLEN SIRAYLA uyguluyor (ardışık işlem);
    // sıranın bozulması randevunun anlamını değiştirir.
    let state = filled();
    state = reduce(state, { type: 'addRow' });
    state = reduce(state, { type: 'service', index: 1, serviceId: SERVICE_2 });
    state = reduce(state, { type: 'staff', index: 1, staffProfileId: STAFF });
    state = reduce(state, { type: 'slot', startsAt: SLOT });

    expect(toCreateBody(state, BRANCH)?.services).toEqual([
      { serviceId: SERVICE, staffProfileId: STAFF },
      { serviceId: SERVICE_2, staffProfileId: STAFF },
    ]);
  });

  it('reset her şeyi ve anahtarı sıfırlıyor', () => {
    const state = reduce(filled(), { type: 'reset' });
    expect(state.customerId).toBeNull();
    expect(state.startsAt).toBeNull();
    expect(state.rows).toHaveLength(1);
  });
});
