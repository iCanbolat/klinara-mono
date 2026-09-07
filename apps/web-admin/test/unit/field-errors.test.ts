import { describe, expect, it } from 'vitest';
import { ApiProblemError, SessionExpiredError } from '../../src/lib/api/client';
import {
  errorFor,
  fieldPath,
  hasFieldErrors,
  toFormErrors,
} from '../../src/lib/forms/field-errors';
import type { ProblemDetails } from '@klinara/shared';

function problem(overrides: Partial<ProblemDetails> = {}): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Gönderilen veri geçersiz',
    status: 400,
    code: 'VALIDATION_FAILED',
    detail: 'Gönderilen veri geçersiz',
    instance: '/api/v1/appointments',
    requestId: 'req-123',
    ...overrides,
  };
}

describe('alan hataları köprüsü', () => {
  it('NOKTALI yolu olduğu gibi anahtar yapıyor', () => {
    // Sunucu iç içe DTO'larda `services.0.serviceId` üretiyor ve form alanı
    // da aynı yolu kullanıyor. Eşleme yapmaya çalışmak (camelCase → alan adı)
    // bir gün sessizce ıskalardı.
    const errors = toFormErrors(
      new ApiProblemError(
        problem({
          errors: [
            { path: 'services.0.serviceId', message: 'Geçerli bir kimlik olmalı' },
            { path: 'startsAt', message: 'ISO 8601 olmalı' },
          ],
        }),
        null,
      ),
    );

    expect(errors.fields['services.0.serviceId']).toBe('Geçerli bir kimlik olmalı');
    expect(errors.fields['startsAt']).toBe('ISO 8601 olmalı');
    expect(hasFieldErrors(errors)).toBe(true);
  });

  it('aynı yola düşen İKİNCİ kuralı yutmuyor ama İLKİNİ gösteriyor', () => {
    const errors = toFormErrors(
      new ApiProblemError(
        problem({
          errors: [
            { path: 'phone', message: 'Boş olamaz' },
            { path: 'phone', message: 'E.164 biçiminde olmalı' },
          ],
        }),
        null,
      ),
    );

    // Kullanıcıya üst üste iki mesaj basmak yerine ilk sebep gösteriliyor.
    expect(errors.fields['phone']).toBe('Boş olamaz');
  });

  it('YOLSUZ alan hatası genel mesaja KATILIYOR, sessizce yutulmuyor', () => {
    // Yutulan bir alan hatası kullanıcı için "kaydet'e bastım, hiçbir şey
    // olmadı" demektir — panelin verebileceği en kötü yanıt.
    const errors = toFormErrors(
      new ApiProblemError(
        problem({ errors: [{ path: '', message: 'Hizmet listesi boş olamaz' }] }),
        null,
      ),
    );

    expect(errors.message).toContain('Hizmet listesi boş olamaz');
    expect(hasFieldErrors(errors)).toBe(false);
  });

  it('alan hatası olmayan problemde yalnız genel mesaj var', () => {
    const errors = toFormErrors(new ApiProblemError(problem({ code: 'SLOT_CONFLICT' }), null));

    expect(errors.message).not.toBeNull();
    expect(errors.fields).toEqual({});
    expect(errors.requestId).toBe('req-123');
  });

  it('OTURUM BİTİŞİ formda hiçbir şey göstermiyor', () => {
    // Oturum bitişini `SessionProvider` bir modalla ele alıyor; aynı olayı
    // formda kırmızı bir satır olarak da göstermek kullanıcıya iki ayrı
    // sorun varmış gibi görünürdü.
    const errors = toFormErrors(new SessionExpiredError());

    expect(errors.message).toBeNull();
    expect(errors.fields).toEqual({});
    expect(errors.requestId).toBeNull();
  });

  it('ağ hatasında bağlantı mesajı dönüyor', () => {
    const errors = toFormErrors(new TypeError('Failed to fetch'));

    expect(errors.message).not.toBeNull();
    expect(errors.fields).toEqual({});
  });

  it('fieldPath sunucunun biçimini üretiyor', () => {
    expect(fieldPath('services', 0, 'serviceId')).toBe('services.0.serviceId');
    expect(fieldPath('startsAt')).toBe('startsAt');
    expect(fieldPath('branchOverrides', 2, 'priceMinor')).toBe('branchOverrides.2.priceMinor');
  });

  it('errorFor eşleşme yoksa undefined döner, boş dize DEĞİL', () => {
    // `Field` boş dizeyi de "hata var" sayıp kırmızı bir boşluk çizerdi.
    const errors = toFormErrors(
      new ApiProblemError(problem({ errors: [{ path: 'phone', message: 'Boş olamaz' }] }), null),
    );

    expect(errorFor(errors, 'phone')).toBe('Boş olamaz');
    expect(errorFor(errors, 'email')).toBeUndefined();
  });
});
