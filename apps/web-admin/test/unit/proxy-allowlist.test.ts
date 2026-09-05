import { describe, expect, it } from 'vitest';
import { isAllowedProxyPath } from '../../src/lib/proxy-allowlist';

const UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

/**
 * `apps/web-booking/test/unit/proxy-allowlist.test.ts`in aynadaki karşılığı,
 * ama reddedilenler listesi çok daha uzun: bu proxy isteğe kullanıcının oturum
 * token'ını ekleyip `/api/v1`in KÖKÜNE gönderiyor.
 */
describe('yönetim proxy beyaz listesi', () => {
  it('kimlik yüzeyinin token üretmeyen uçları geçiyor', () => {
    expect(isAllowedProxyPath('me', 'GET')).toBe(true);
    expect(isAllowedProxyPath('me', 'PATCH')).toBe(true);
    expect(isAllowedProxyPath('branches', 'GET')).toBe(true);
    expect(isAllowedProxyPath('auth/sessions', 'GET')).toBe(true);
    expect(isAllowedProxyPath(`auth/sessions/${UUID}`, 'DELETE')).toBe(true);
    expect(isAllowedProxyPath('auth/logout-all', 'POST')).toBe(true);
    expect(isAllowedProxyPath('auth/password/change', 'POST')).toBe(true);
    expect(isAllowedProxyPath('auth/2fa', 'GET')).toBe(true);
    expect(isAllowedProxyPath('auth/2fa', 'DELETE')).toBe(true);
    expect(isAllowedProxyPath('auth/2fa/backup-codes', 'POST')).toBe(true);
  });

  it('passkey KAYDI (çoğul) geçiyor, passkey GİRİŞİ (tekil) geçmiyor', () => {
    // Kayıt oturum açıkken yapılır ve token üretmez; giriş token üretir ve
    // cookie yazması gerekir — o yüzden kendi handler'ında.
    expect(isAllowedProxyPath('auth/passkeys/register/options', 'POST')).toBe(true);
    expect(isAllowedProxyPath('auth/passkeys/register', 'POST')).toBe(true);
    expect(isAllowedProxyPath('auth/passkeys', 'GET')).toBe(true);
    expect(isAllowedProxyPath(`auth/passkeys/${UUID}`, 'PATCH')).toBe(true);
    expect(isAllowedProxyPath(`auth/passkeys/${UUID}`, 'DELETE')).toBe(true);

    expect(isAllowedProxyPath('auth/passkey/options', 'POST')).toBe(false);
    expect(isAllowedProxyPath('auth/passkey/verify', 'POST')).toBe(false);
  });

  it('randevu sayfası yüzeyinin tamamı geçiyor', () => {
    expect(isAllowedProxyPath('booking-page', 'GET')).toBe(true);
    expect(isAllowedProxyPath('booking-page', 'PUT')).toBe(true);
    expect(isAllowedProxyPath('booking-page/content', 'GET')).toBe(true);
    expect(isAllowedProxyPath('booking-page/content', 'PUT')).toBe(true);
    expect(isAllowedProxyPath('booking-page/content/revisions', 'GET')).toBe(true);
    expect(isAllowedProxyPath(`booking-page/content/rollback/${UUID}`, 'POST')).toBe(true);
    expect(isAllowedProxyPath('booking-page/preview', 'GET')).toBe(true);
    expect(isAllowedProxyPath('booking-page/publish', 'POST')).toBe(true);
    expect(isAllowedProxyPath('booking-page/unpublish', 'POST')).toBe(true);
    expect(isAllowedProxyPath('booking-page/assets', 'GET')).toBe(true);
    expect(isAllowedProxyPath('booking-page/assets/presign', 'POST')).toBe(true);
    expect(isAllowedProxyPath('booking-page/assets/confirm', 'POST')).toBe(true);
    expect(isAllowedProxyPath(`booking-page/assets/${UUID}`, 'DELETE')).toBe(true);
    expect(isAllowedProxyPath('booking-page/domains', 'GET')).toBe(true);
    expect(isAllowedProxyPath('booking-page/domains', 'POST')).toBe(true);
    expect(isAllowedProxyPath(`booking-page/domains/${UUID}`, 'DELETE')).toBe(true);
    expect(isAllowedProxyPath(`booking-page/domains/${UUID}/verify`, 'POST')).toBe(true);
    expect(isAllowedProxyPath(`booking-page/domains/${UUID}/primary`, 'POST')).toBe(true);
  });

  it('TOKEN ÜRETEN uçların hiçbiri geçmiyor', () => {
    // Buradan geçselerdi token gövdeyle tarayıcıya inerdi — BFF'in tek amacı
    // çöpe giderdi.
    for (const path of [
      'auth/login',
      'auth/tenant',
      'auth/refresh',
      'auth/logout',
      'auth/2fa/verify',
      'auth/2fa/setup',
      'auth/2fa/enable',
      'auth/password/forgot',
      'auth/password/reset',
      'invitations/token/abc123',
      'invitations/token/abc123/accept',
    ]) {
      expect(isAllowedProxyPath(path, 'POST'), path).toBe(false);
      expect(isAllowedProxyPath(path, 'GET'), path).toBe(false);
    }
  });

  it('iç, platform ve public yüzeyler geçmiyor', () => {
    for (const path of [
      'internal/booking-domains/authorize',
      'platform/tenants',
      'webhooks/whatsapp',
      'metrics',
      'healthz',
      'public/resolve',
      'public/sites/klinik-x',
      'uploads/local/x',
    ]) {
      expect(isAllowedProxyPath(path, 'GET'), path).toBe(false);
      expect(isAllowedProxyPath(path, 'POST'), path).toBe(false);
    }
  });

  it('kategori listesi YALNIZ okunabiliyor — istisna dar', () => {
    // `serviceList` bloğu kimlikleri bir ADLA eşleştirmek zorunda; istisnanın
    // genişlemesi bu testin kırılmasıyla görünür olsun.
    expect(isAllowedProxyPath('service-categories', 'GET')).toBe(true);
    expect(isAllowedProxyPath('service-categories', 'POST')).toBe(false);
    expect(isAllowedProxyPath('service-categories', 'PATCH')).toBe(false);
    expect(isAllowedProxyPath('service-categories', 'DELETE')).toBe(false);
    expect(isAllowedProxyPath(`service-categories/${UUID}`, 'GET')).toBe(false);
  });

  it('klinik operasyonu yüzeyinin TAMAMI kapsam dışı', () => {
    // Kapsam kararı gereği; buraya bir kural eklemek bilinçli bir sürtünme.
    //
    // `reports/revenue` bu listeden 10.1'de ÇIKARILDI ve bu bilinçli bir
    // karar: rapor uçları salt okunur ve toplu veri döndürüyor, müşteri kaydı
    // ya da yazma yüzeyi açmıyorlar (gerekçe `proxy-allowlist.ts` başlığında,
    // kapsamı da aşağıdaki "raporlar" bloğunda sınanıyor). Listenin geri
    // kalanı olduğu gibi duruyor.
    for (const path of [
      'appointments',
      `appointments/${UUID}`,
      'calendar/day',
      'availability',
      'customers',
      `customers/${UUID}`,
      'payments',
      'charges',
      'cash/sessions',
      'packages',
      'staff',
      'services',
      'schedules',
    ]) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(isAllowedProxyPath(path, method), `${method} ${path}`).toBe(false);
      }
    }
  });

  it('metot uyuşmazlığı reddediliyor', () => {
    expect(isAllowedProxyPath('branches', 'DELETE')).toBe(false);
    expect(isAllowedProxyPath('booking-page/content/revisions', 'PUT')).toBe(false);
    expect(isAllowedProxyPath('me', 'DELETE')).toBe(false);
    expect(isAllowedProxyPath('booking-page/publish', 'GET')).toBe(false);
  });

  it('UUID olmayan yol parçası reddediliyor', () => {
    // Kural gevşek olsaydı `booking-page/domains/../../auth/login` gibi bir yol
    // eşleşebilirdi.
    expect(isAllowedProxyPath('booking-page/domains/hepsi', 'DELETE')).toBe(false);
    expect(isAllowedProxyPath('auth/sessions/tumu', 'DELETE')).toBe(false);
    expect(isAllowedProxyPath('booking-page/assets/xyz', 'DELETE')).toBe(false);
  });

  it('yol geçişi ve kodlanmış ayraçlar ölüyor', () => {
    for (const path of [
      '../auth/login',
      'booking-page/../auth/login',
      'me/..',
      'booking-page//content',
      'booking-page\\content',
      '/me',
      'me/',
      '..%2fauth/login',
      'booking-page%2F..%2Fauth',
      'me%2e%2e',
    ]) {
      expect(isAllowedProxyPath(path, 'GET'), path).toBe(false);
    }
  });

  it('aşırı uzun yol reddediliyor', () => {
    expect(isAllowedProxyPath('a'.repeat(4097), 'GET')).toBe(false);
  });

  it('boş yol reddediliyor', () => {
    expect(isAllowedProxyPath('', 'GET')).toBe(false);
  });

  it('metot büyük/küçük harften bağımsız', () => {
    expect(isAllowedProxyPath('me', 'get')).toBe(true);
    expect(isAllowedProxyPath('booking-page', 'put')).toBe(true);
  });

  // -------------------------------------------------------------------------
  describe('raporlar (10.1)', () => {
    it('beş rapor ucu ve paket raporları GET ile geçiyor', () => {
      for (const path of [
        'reports/occupancy',
        'reports/revenue',
        'reports/staff-performance',
        'reports/no-show',
        'reports/retention',
        'reports/packages/outstanding',
        'reports/packages/expiring',
        'reports/packages/usage',
      ]) {
        expect(isAllowedProxyPath(path, 'GET'), path).toBe(true);
      }
    });

    it('dışa aktarım YALNIZ POST ve yalnız `/export` ile', () => {
      expect(isAllowedProxyPath('reports/revenue/export', 'POST')).toBe(true);
      // Rapor ucunun kendisine POST edilemez: okuma ucu, yazma değil.
      expect(isAllowedProxyPath('reports/revenue', 'POST')).toBe(false);
      // Dışa aktarım GET değil (gövde bir filtre taşıyor).
      expect(isAllowedProxyPath('reports/revenue/export', 'GET')).toBe(false);
      // Paket raporlarının dışa aktarımı YOK.
      expect(isAllowedProxyPath('reports/packages/usage/export', 'POST')).toBe(false);
    });

    it('`reports/` önekine JOKER verilmemiş', () => {
      // Kural tek tek yazıldı; joker olsaydı yarın eklenecek bir
      // `reports/customers/:id` ucu sessizce açılırdı.
      for (const path of [
        'reports',
        'reports/',
        'reports/customers',
        'reports/commissions',
        'reports/occupancy/extra',
        'reports/packages',
      ]) {
        expect(isAllowedProxyPath(path, 'GET'), path).toBe(false);
      }
    });

    it('rapor yolları da yol geçişine kapalı', () => {
      expect(isAllowedProxyPath('reports/../me', 'GET')).toBe(false);
      expect(isAllowedProxyPath('reports%2F..%2Fme', 'GET')).toBe(false);
    });

    it('klinik operasyonu HÂLÂ dışarıda', () => {
      // Raporların eklenmesi o sınırı gevşetmedi.
      for (const path of ['appointments', 'customers', 'payments', 'charges', 'packages']) {
        expect(isAllowedProxyPath(path, 'GET'), path).toBe(false);
      }
    });
  });
});
