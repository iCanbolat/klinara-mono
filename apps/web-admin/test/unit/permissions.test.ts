import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_DEFINITIONS } from '@klinara/shared';
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
    // Karşılama sayfası ve hesap izin istemiyor; geri kalan her şey istiyor.
    expect(nav.map((item) => item.path)).toEqual(['/dashboard', '/hesap']);
  });

  it('karşılama sayfası menünün BAŞINDA', () => {
    expect(visibleNav([READ])[0]?.path).toBe('/dashboard');
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
    expect(visibleNav([MANAGE]).map((item) => item.path)).toEqual(['/dashboard', '/hesap']);
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
      // Yalnız ciro izni olan, yalnız takvim izni olan (resepsiyon) ve yalnız
      // kendi performansını gören (uygulayıcı) raporlar menüsünü GÖRMELİ. Yalnız VE ile ifade etseydik ikisi de
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

  describe('klinik operasyonu menüsü (12.2)', () => {
    // Roller `ROLE_DEFINITIONS`tan okunuyor, elle yazılmıyor: sunucuda bir
    // rolün izni değişirse bu testler onunla birlikte değişmeli.
    const roleOf = (key: string): string[] => {
      const role = ROLE_DEFINITIONS.find((definition) => definition.key === key);
      if (role === undefined) throw new Error(`rol yok: ${key}`);
      return [...role.permissions];
    };

    it('randevu izni olmayan rol dört klinik ekranını da GÖRMÜYOR', () => {
      // Yalnız müşteri okuyabilen bir rol: takvimi menüde göstermek ona boş
      // bir ızgara açardı — yani "bugün randevu yok" demek olurdu.
      const customerOnly = [PERMISSIONS.CUSTOMER_READ];
      const paths = visibleNav(customerOnly).map((item) => item.path);

      expect(paths).not.toContain('/takvim');
      expect(paths).not.toContain('/katalog');
      expect(paths).not.toContain('/personel');
      expect(paths).not.toContain('/calisma-saatleri');
      expect(paths).toContain('/musteriler');
      expect(canOpenPath(customerOnly, '/takvim')).toBe(false);
      expect(canOpenPath(customerOnly, '/katalog')).toBe(false);
    });

    it('rol listesinde muhasebe rolü YOK (kapsam dışı)', () => {
      expect(ROLE_DEFINITIONS.map((role) => role.key)).not.toContain('accountant');
    });

    it('UYGULAYICI takvimi görüyor — `read.own` yeterli', () => {
      // `requires` ile yazılsaydı görmezdi: uygulayıcı `read.all` taşımıyor.
      const practitioner = roleOf('practitioner');
      expect(practitioner).not.toContain(PERMISSIONS.APPOINTMENT_READ_ALL);
      expect(visibleNav(practitioner).map((item) => item.path)).toContain('/takvim');
      expect(canOpenPath(practitioner, '/takvim')).toBe(true);
    });

    it('RESEPSİYON dört ekranı da görüyor', () => {
      const paths = visibleNav(roleOf('receptionist')).map((item) => item.path);
      for (const path of ['/takvim', '/musteriler', '/katalog', '/personel', '/calisma-saatleri']) {
        expect(paths, path).toContain(path);
      }
    });
  });

  it('tanımsız rota engellenmiyor — kapı burada değil', () => {
    // Yetkinin otoritesi API'nin PermissionsGuard'ı; buradaki liste bir
    // kullanılabilirlik katmanı. Bilinmeyen bir rotayı burada reddetmek yanlış
    // bir güvenlik hissi verirdi.
    expect(canOpenPath([], '/bilinmeyen')).toBe(true);
  });
});
