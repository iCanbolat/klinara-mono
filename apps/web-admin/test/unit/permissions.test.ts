import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@klinara/shared';
import {
  bookingPageAccess,
  can,
  canAny,
  canOpenPath,
  visibleNav,
} from '../../src/lib/permissions';

const READ = PERMISSIONS.BOOKING_PAGE_READ;
const MANAGE = PERMISSIONS.BOOKING_PAGE_MANAGE;

describe('izin kontrolü', () => {
  it('can TÜM izinleri, canAny HERHANGİ BİRİNİ arıyor', () => {
    expect(can([READ, MANAGE], READ, MANAGE)).toBe(true);
    expect(can([READ], READ, MANAGE)).toBe(false);
    expect(canAny([READ], READ, MANAGE)).toBe(true);
    expect(canAny([], READ, MANAGE)).toBe(false);
    // Boş gereksinim listesi herkese açık demek.
    expect(can([], )).toBe(true);
  });

  it('MANAGE, READ’i KAPSAMIYOR', () => {
    // `packages/shared/src/permissions.ts` bunu bilerek böyle kuruyor. Yalnız
    // manage taşıyan bir kullanıcı içeriği kaydedebilir ama okuyamaz — üzerine
    // yazacağı şeyi görmeden kaydetmesi sessiz veri kaybının ta kendisi.
    expect(bookingPageAccess([MANAGE])).toBe('misconfigured');
    expect(bookingPageAccess([READ])).toBe('read-only');
    expect(bookingPageAccess([READ, MANAGE])).toBe('full');
    expect(bookingPageAccess([])).toBe('none');
  });
});

describe('izne göre navigasyon', () => {
  it('izni olmayan öge DÖNMÜYOR (CSS ile gizlenmiyor)', () => {
    const nav = visibleNav([]);
    expect(nav.map((item) => item.path)).toEqual(['/hesap']);
  });

  it('booking_page:read olan kullanıcı üç bölümü de görüyor', () => {
    const paths = visibleNav([READ]).map((item) => item.path);
    expect(paths).toContain('/sayfa');
    expect(paths).toContain('/icerik');
    expect(paths).toContain('/alan-adlari');
  });

  it('yalnız MANAGE taşıyan kullanıcı menüde içerik GÖRMÜYOR', () => {
    // Menü `read` istiyor; yapılandırma hatası olan kullanıcı doğrudan URL ile
    // girip anlaşılır paneli görüyor (bkz. bookingPageAccess).
    expect(visibleNav([MANAGE]).map((item) => item.path)).toEqual(['/hesap']);
  });

  it('doğrudan URL kontrolü alt rotaları da kapsıyor', () => {
    expect(canOpenPath([READ], '/icerik')).toBe(true);
    expect(canOpenPath([READ], '/icerik/surumler')).toBe(true);
    expect(canOpenPath([], '/icerik/surumler')).toBe(false);
    expect(canOpenPath([], '/hesap/guvenlik')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  describe('raporlar menüsü (10.1)', () => {
    const REVENUE = PERMISSIONS.REPORT_REVENUE_READ;
    const CALENDAR = PERMISSIONS.APPOINTMENT_READ_ALL;
    const OWN = PERMISSIONS.REPORT_PERFORMANCE_READ_OWN;

    it('`requiresAny` VEYA olarak çalışıyor', () => {
      // Muhasebecide takvim izni yok, resepsiyonda ciro izni yok; ikisi de
      // raporlar menüsünü GÖRMELİ. Yalnız VE ile ifade etseydik ikisi de
      // menüden düşerdi.
      expect(visibleNav([REVENUE]).map((item) => item.path)).toContain('/raporlar');
      expect(visibleNav([CALENDAR]).map((item) => item.path)).toContain('/raporlar');
      expect(visibleNav([OWN]).map((item) => item.path)).toContain('/raporlar');
    });

    it('hiçbiri yoksa menüde YOK', () => {
      expect(visibleNav([]).map((item) => item.path)).not.toContain('/raporlar');
    });

    it('doğrudan URL kontrolü aynı kuralı uyguluyor', () => {
      expect(canOpenPath([REVENUE], '/raporlar')).toBe(true);
      expect(canOpenPath([REVENUE], '/raporlar/ciro')).toBe(true);
      expect(canOpenPath([], '/raporlar')).toBe(false);
      expect(canOpenPath([], '/raporlar/ciro')).toBe(false);
    });
  });

  it('tanımsız rota engellenmiyor — kapı burada değil', () => {
    // Yetkinin otoritesi API'nin PermissionsGuard'ı; buradaki liste bir
    // kullanılabilirlik katmanı. Bilinmeyen bir rotayı burada reddetmek yanlış
    // bir güvenlik hissi verirdi.
    expect(canOpenPath([], '/bilinmeyen')).toBe(true);
  });
});
