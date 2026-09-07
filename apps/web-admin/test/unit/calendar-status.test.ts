import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES, PERMISSIONS, type AppointmentStatus } from '@klinara/shared';
import {
  STATUS_LABEL,
  STATUS_TONE,
  isTerminal,
  occupiesSlot,
  statusActions,
} from '../../src/lib/calendar/status';

const MANAGER = [PERMISSIONS.APPOINTMENT_WRITE, PERMISSIONS.APPOINTMENT_REOPEN];
const RECEPTION = [PERMISSIONS.APPOINTMENT_WRITE];

const targets = (status: AppointmentStatus, permissions: readonly string[]): string[] =>
  statusActions(status, permissions).map((action) => action.to);

describe('randevu durum makinesi', () => {
  it('her durumun rozeti ve etiketi TANIMLI', () => {
    // Eksik bir eşleme, ekranda `undefined` bir rozet demek.
    for (const status of APPOINTMENT_STATUSES) {
      expect(STATUS_TONE[status]).toBeDefined();
      expect(STATUS_LABEL[status]).toBeDefined();
    }
  });

  it('ileri geçişler sunucunun tablosuyla aynı', () => {
    expect(targets('scheduled', RECEPTION)).toEqual([
      'confirmed',
      'arrived',
      'no_show',
      'cancelled',
    ]);
    expect(targets('confirmed', RECEPTION)).toEqual(['arrived', 'no_show', 'cancelled']);
    expect(targets('arrived', RECEPTION)).toEqual(['in_progress', 'no_show', 'cancelled']);
    expect(targets('in_progress', RECEPTION)).toEqual(['completed', 'cancelled']);
  });

  it('GERİYE geçiş yok — `confirmed`ten `scheduled`e dönülemez', () => {
    expect(targets('confirmed', MANAGER)).not.toContain('scheduled');
    expect(targets('arrived', MANAGER)).not.toContain('confirmed');
    expect(targets('in_progress', MANAGER)).not.toContain('arrived');
  });

  it('`cancelled` ve `no_show` TERMİNAL', () => {
    // İptal edilen randevu geri açılmaz; `resource_bookings` satırı zaten
    // `active=false` ve slot serbest kalmıştır. Yenisi oluşturulur.
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('no_show')).toBe(true);
    expect(statusActions('cancelled', MANAGER)).toEqual([]);
    expect(statusActions('no_show', MANAGER)).toEqual([]);
  });

  it('`completed`ten çıkış izin İSTİYOR ve izinsizken ETKİSİZ', () => {
    // ASIL İDDİA: düğme listeden ÇIKARILMIYOR, etkisizleştiriliyor.
    // Hiç göstermemek uygulayıcıya "böyle bir şey yapılamaz" derdi; etkisiz
    // ve sebebi yazılı bir düğme "yapılabilir ama yetkiniz yok" der.
    const withoutReopen = statusActions('completed', RECEPTION);
    expect(withoutReopen.map((a) => a.to)).toEqual(['in_progress', 'cancelled']);
    for (const action of withoutReopen) {
      expect(action.allowed).toBe(false);
      expect(action.reasonKey).toBeDefined();
    }

    const withReopen = statusActions('completed', MANAGER);
    for (const action of withReopen) {
      expect(action.allowed).toBe(true);
      expect(action.reasonKey).toBeUndefined();
    }
  });

  it('izin gerektirmeyen geçişler her zaman etkin', () => {
    for (const action of statusActions('scheduled', RECEPTION)) {
      expect(action.allowed).toBe(true);
    }
  });

  it('iptal edilen ve gelmeyen randevu SLOT KAPLAMAZ', () => {
    // Sunucu bu ikisinde `resource_bookings.active = false` yapıyor. Izgarada
    // normal blok gibi çizmek, boş olan bir saati dolu göstermek olurdu.
    expect(occupiesSlot('cancelled')).toBe(false);
    expect(occupiesSlot('no_show')).toBe(false);

    for (const status of ['scheduled', 'confirmed', 'arrived', 'in_progress', 'completed'] as const) {
      expect(occupiesSlot(status), status).toBe(true);
    }
  });

  it('hiçbir geçiş KENDİ durumuna gitmiyor', () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(targets(status, MANAGER)).not.toContain(status);
    }
  });
});
