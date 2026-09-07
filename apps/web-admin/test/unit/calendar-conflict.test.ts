import { describe, expect, it } from 'vitest';
import { ApiProblemError, SessionExpiredError } from '../../src/lib/api/client';
import { readSlotConflict } from '../../src/lib/calendar/conflict';

function conflictError(extra: Record<string, unknown>): ApiProblemError {
  return new ApiProblemError(
    {
      type: 'about:blank',
      title: 'Seçilen saat dolu',
      status: 409,
      code: 'SLOT_CONFLICT',
      detail: 'Kaynak bu aralıkta başka bir kayıt tarafından tutuluyor.',
      instance: '/api/v1/appointments',
      requestId: 'req-1',
      ...extra,
    },
    null,
  );
}

const SUGGESTION = {
  startsAt: '2026-09-07T14:30:00+03:00',
  endsAt: '2026-09-07T15:00:00+03:00',
  staffProfileIds: ['s1'],
};

describe('slot çakışması okuyucusu', () => {
  it('önerileri ve çakışmaları çıkarıyor', () => {
    const result = readSlotConflict(
      conflictError({
        suggestions: [SUGGESTION],
        conflicts: [
          {
            resourceType: 'staff',
            resourceId: 's1',
            appointmentId: 'a1',
            from: '2026-09-07T14:00:00.000Z',
            to: '2026-09-07T14:30:00.000Z',
          },
        ],
      }),
    );

    expect(result?.suggestions).toEqual([SUGGESTION]);
    expect(result?.conflicts).toHaveLength(1);
    expect(result?.conflicts[0]?.appointmentId).toBe('a1');
  });

  it('BAŞKA bir hata kodunda null döner', () => {
    // `null` = "çakışma değil"; çağıran olağan hata metnine düşer.
    const other = new ApiProblemError(
      {
        type: 'about:blank',
        title: 'Yetkiniz yok',
        status: 403,
        code: 'FORBIDDEN',
        instance: '/api/v1/appointments',
        requestId: 'req-2',
      },
      null,
    );
    expect(readSlotConflict(other)).toBeNull();
  });

  it('ApiProblemError olmayan hatada null döner', () => {
    expect(readSlotConflict(new SessionExpiredError())).toBeNull();
    expect(readSlotConflict(new TypeError('Failed to fetch'))).toBeNull();
    expect(readSlotConflict('bir dize')).toBeNull();
  });

  it('ÖNERİ BOŞ gelebilir ve bu bir hata değil', () => {
    // Sunucu öneri üretimini `.catch(() => [])` ile koruyor: öneri
    // üretilemese bile çakışma bilgisi kaybolmasın diye. Arayüz bunu bir son
    // olarak değil bir dallanma olarak ele almalı.
    const result = readSlotConflict(conflictError({ suggestions: [], conflicts: [] }));
    expect(result).not.toBeNull();
    expect(result?.suggestions).toEqual([]);
  });

  it('alanlar HİÇ YOKSA boş diziye düşer, patlamaz', () => {
    // Bir teşhis alanı yüzünden randevu ekranının patlaması, çakışmanın
    // kendisinden kötü olurdu.
    const result = readSlotConflict(conflictError({}));
    expect(result).toEqual({ conflicts: [], suggestions: [] });
  });

  it('BOZUK öneri kaydı atlanıyor, sağlamlar korunuyor', () => {
    const result = readSlotConflict(
      conflictError({
        suggestions: [
          SUGGESTION,
          { endsAt: '2026-09-07T16:00:00+03:00' }, // startsAt yok
          'dize',
          null,
          { startsAt: '2026-09-07T16:00:00+03:00', endsAt: '2026-09-07T16:30:00+03:00' },
        ],
      }),
    );

    expect(result?.suggestions).toHaveLength(2);
    // Saat olmadan bir öneri düğmesi çizilemez; o kayıt atlandı.
    expect(result?.suggestions[0]).toEqual(SUGGESTION);
    // `staffProfileIds` eksikse boş dizi — alan hiç olmayabilir.
    expect(result?.suggestions[1]?.staffProfileIds).toEqual([]);
  });

  it('suggestions dizi DEĞİLSE boş diziye düşer', () => {
    const result = readSlotConflict(conflictError({ suggestions: { hepsi: 'dolu' } }));
    expect(result?.suggestions).toEqual([]);
  });
});
