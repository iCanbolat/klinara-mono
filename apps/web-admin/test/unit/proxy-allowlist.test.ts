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

  it('kategori yüzeyi 12.4te GENİŞLETİLDİ — ve bu görünür bir karar', () => {
    // Bu test Faz 11'de "istisnanın genişlemesi kırılmasıyla görünür olsun"
    // diye yazılmıştı ve İŞİNİ YAPTI: 12.4 katalog ekranını getirince kırıldı
    // ve genişletme bilinçli olarak buraya kaydedildi.
    //
    // Faz 11'de `GET service-categories` TEK istisnaydı; editörün blok
    // süzgeci kimlikleri bir adla eşleştirmek zorundaydı. 12.4 katalog
    // yönetimini getirdi, dolayısıyla yazma da açıldı.
    expect(isAllowedProxyPath('service-categories', 'GET')).toBe(true);
    expect(isAllowedProxyPath('service-categories', 'POST')).toBe(true);
    expect(isAllowedProxyPath(`service-categories/${UUID}`, 'PATCH')).toBe(true);
    expect(isAllowedProxyPath(`service-categories/${UUID}`, 'DELETE')).toBe(true);

    // Sunucuda TEKİL kategori GET'i YOK; beyaz listede de yok.
    expect(isAllowedProxyPath(`service-categories/${UUID}`, 'GET')).toBe(false);
    expect(isAllowedProxyPath('service-categories', 'PUT')).toBe(false);
  });

  it('PARA, PAKET ve DENETİM yüzeyi hâlâ tamamen kapsam dışı', () => {
    // Faz 12 klinik operasyonunu açtı ama bunları AÇMADI ve açmamalı:
    // Faz 12'nin hiçbir ekranı bu uçları istemiyor. Kural aynı — uç buraya
    // yazılmadıkça geçmez.
    //
    // `reports/*` bu listede DEĞİL çünkü 10.1'de bilinçli olarak çıkarıldı:
    // salt okunur ve toplu veri döndürüyorlar (gerekçe `proxy-allowlist.ts`
    // başlığında, kapsamı aşağıdaki "raporlar" bloğunda sınanıyor).
    for (const path of [
      'payments',
      `payments/${UUID}`,
      'charges',
      'cash-sessions',
      'refunds',
      'discounts',
      'commission-rules',
      'commission-periods',
      'package-definitions',
      'customer-packages',
      `customer-packages/${UUID}/refund`,
      // Faz 7 daraltılınca bu iki tablo HİÇ yazılmadı; uçları yok, kapıları
      // da kapalı kalıyor.
      'consent-templates',
      'consent-records',
      'messages',
      'audit-log',
    ]) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(isAllowedProxyPath(path, method), `${method} ${path}`).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  describe('onam metni (Faz 7)', () => {
    it('sürümlü onam metni yüzeyi geçiyor', () => {
      expect(isAllowedProxyPath('consent-document', 'GET')).toBe(true);
      expect(isAllowedProxyPath('consent-document/draft', 'PUT')).toBe(true);
      expect(isAllowedProxyPath('consent-document/publish', 'POST')).toBe(true);
      expect(isAllowedProxyPath('consent-document/versions', 'GET')).toBe(true);
      expect(isAllowedProxyPath('consent-acceptances', 'GET')).toBe(true);
    });

    it('yöntem daraltması korunuyor', () => {
      // Yayınlanmış metin DEĞİŞTİRİLEMEZ ve SİLİNEMEZ; kapı da öyle.
      expect(isAllowedProxyPath('consent-document', 'PUT')).toBe(false);
      expect(isAllowedProxyPath('consent-document', 'DELETE')).toBe(false);
      expect(isAllowedProxyPath('consent-document/draft', 'DELETE')).toBe(false);
      expect(isAllowedProxyPath('consent-document/versions', 'POST')).toBe(false);
      // Kabul kanıtı yalnız OKUNUR — panelden yazılamaz.
      expect(isAllowedProxyPath('consent-acceptances', 'POST')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('takvim ve randevu (12.2)', () => {
    it('randevu yaşam döngüsü geçiyor', () => {
      expect(isAllowedProxyPath('appointments', 'GET')).toBe(true);
      expect(isAllowedProxyPath('appointments', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`appointments/${UUID}`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`appointments/${UUID}`, 'PATCH')).toBe(true);
      expect(isAllowedProxyPath(`appointments/${UUID}/history`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`appointments/${UUID}/reschedule`, 'POST')).toBe(true);
      expect(isAllowedProxyPath(`appointments/${UUID}/cancel`, 'POST')).toBe(true);
      expect(isAllowedProxyPath(`appointments/${UUID}/status`, 'POST')).toBe(true);
    });

    it('randevu SİLİNEMEZ — iptal edilir', () => {
      expect(isAllowedProxyPath(`appointments/${UUID}`, 'DELETE')).toBe(false);
      expect(isAllowedProxyPath('appointments', 'DELETE')).toBe(false);
      expect(isAllowedProxyPath('appointments', 'PUT')).toBe(false);
    });

    it('takvim ve uygunluk YALNIZ okunuyor', () => {
      expect(isAllowedProxyPath('calendar/day', 'GET')).toBe(true);
      expect(isAllowedProxyPath('calendar/week', 'GET')).toBe(true);
      expect(isAllowedProxyPath('calendar/staff', 'GET')).toBe(true);
      expect(isAllowedProxyPath('availability', 'GET')).toBe(true);

      expect(isAllowedProxyPath('calendar/day', 'POST')).toBe(false);
      expect(isAllowedProxyPath('availability', 'POST')).toBe(false);
      // Uydurma alt yol geçmiyor.
      expect(isAllowedProxyPath('calendar/month', 'GET')).toBe(false);
      expect(isAllowedProxyPath('calendar', 'GET')).toBe(false);
    });

    it('katalog ve personel OKUMASI randevu formu için açık', () => {
      // Okuma 12.2'de açıldı (randevu formu onlarsız kurulamaz); yazma
      // 12.4'te kendi ekranlarıyla geldi. Ayrım `Rule`ün metot bazlı
      // olmasıyla bedava.
      expect(isAllowedProxyPath('services', 'GET')).toBe(true);
      expect(isAllowedProxyPath(`services/${UUID}`, 'GET')).toBe(true);
      expect(isAllowedProxyPath('staff', 'GET')).toBe(true);
      expect(isAllowedProxyPath(`staff/${UUID}`, 'GET')).toBe(true);
    });

    it('UYDURMA alt yollar reddediliyor', () => {
      expect(isAllowedProxyPath(`services/${UUID}/anything`, 'GET')).toBe(false);
      expect(isAllowedProxyPath(`appointments/${UUID}/delete`, 'POST')).toBe(false);
      expect(isAllowedProxyPath(`appointments/${UUID}/payments`, 'GET')).toBe(false);
      expect(isAllowedProxyPath(`staff/${UUID}/payments`, 'GET')).toBe(false);
    });

    it('müşteri ARAMASI dar bir kapı olarak açık', () => {
      // `q >= 2`, çıplak dizi, sayfalama yok: defter SIRAYLA TARANAMAZ.
      expect(isAllowedProxyPath('customers/search', 'GET')).toBe(true);
      expect(isAllowedProxyPath('customers/search', 'POST')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('müşteri kartı (12.3)', () => {
    it('defter ve kart yüzeyi geçiyor', () => {
      expect(isAllowedProxyPath('customers', 'GET')).toBe(true);
      expect(isAllowedProxyPath('customers', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}`, 'PATCH')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}`, 'DELETE')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}/tags`, 'PUT')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}/merge`, 'POST')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}/timeline`, 'GET')).toBe(true);
    });

    it('not ve etiket yüzeyi geçiyor', () => {
      expect(isAllowedProxyPath(`customers/${UUID}/notes`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}/notes`, 'POST')).toBe(true);
      expect(isAllowedProxyPath(`notes/${UUID}`, 'PATCH')).toBe(true);
      expect(isAllowedProxyPath(`notes/${UUID}`, 'DELETE')).toBe(true);
      expect(isAllowedProxyPath(`notes/${UUID}/revisions`, 'GET')).toBe(true);
      expect(isAllowedProxyPath('customer-tags', 'GET')).toBe(true);
      expect(isAllowedProxyPath('customer-tags', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`customer-tags/${UUID}`, 'PATCH')).toBe(true);
    });

    it('dosya yüzeyi geçiyor', () => {
      expect(isAllowedProxyPath('uploads/presign', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}/files`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}/files`, 'POST')).toBe(true);
      expect(isAllowedProxyPath(`customers/${UUID}/file-groups`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`files/${UUID}/download-url`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`files/${UUID}`, 'DELETE')).toBe(true);
    });

    it('metot uyuşmazlıkları ve UYDURMA alt yollar reddediliyor (12.3)', () => {
      expect(isAllowedProxyPath('customers', 'PUT')).toBe(false);
      expect(isAllowedProxyPath(`customers/${UUID}/merge`, 'GET')).toBe(false);
      expect(isAllowedProxyPath(`customers/${UUID}/tags`, 'POST')).toBe(false);
      expect(isAllowedProxyPath(`notes/${UUID}`, 'GET')).toBe(false);
      expect(isAllowedProxyPath(`files/${UUID}/download-url`, 'POST')).toBe(false);
      // Kardeş yol: paket ve ödeme HÂLÂ kapalı.
      expect(isAllowedProxyPath(`customers/${UUID}/packages`, 'GET')).toBe(false);
      expect(isAllowedProxyPath(`customers/${UUID}/account`, 'GET')).toBe(false);
      expect(isAllowedProxyPath(`customers/${UUID}/opt-out`, 'GET')).toBe(false);
      expect(isAllowedProxyPath('uploads/local/put', 'PUT')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('katalog, personel ve plan (12.4)', () => {
    it('katalog YAZMA açıldı', () => {
      expect(isAllowedProxyPath('services', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`services/${UUID}`, 'PATCH')).toBe(true);
      expect(isAllowedProxyPath(`services/${UUID}`, 'DELETE')).toBe(true);
      expect(isAllowedProxyPath('service-categories', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`service-categories/${UUID}`, 'PATCH')).toBe(true);
    });

    it('personel YAZMA ve yetkinlik matrisi açıldı', () => {
      expect(isAllowedProxyPath('staff', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`staff/${UUID}`, 'PATCH')).toBe(true);
      expect(isAllowedProxyPath(`staff/${UUID}/services`, 'PUT')).toBe(true);
      expect(isAllowedProxyPath('users', 'GET')).toBe(true);
      expect(isAllowedProxyPath(`users/${UUID}`, 'PATCH')).toBe(true);
    });

    it('çalışma planı açıldı; istisnada PATCH YOK', () => {
      expect(isAllowedProxyPath(`branches/${UUID}/hours`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`branches/${UUID}/hours`, 'PUT')).toBe(true);
      expect(isAllowedProxyPath(`staff/${UUID}/schedule`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`staff/${UUID}/schedule`, 'PUT')).toBe(true);
      expect(isAllowedProxyPath('schedule-exceptions', 'GET')).toBe(true);
      expect(isAllowedProxyPath('schedule-exceptions', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`schedule-exceptions/${UUID}`, 'DELETE')).toBe(true);

      // Sunucuda `PATCH /schedule-exceptions/:id` YOK; beyaz listede de yok.
      expect(isAllowedProxyPath(`schedule-exceptions/${UUID}`, 'PATCH')).toBe(false);
    });

    it('rol ve tatil yüzeyi açıldı; KULLANICI SİLME hâlâ kapalı', () => {
      // Rol değiştirme ucu (`PUT users/:id/memberships`) ve tatil uçları
      // sunucuda artık VAR; ikisi de Faz 1/Faz 3'ten devreden maddelerdi.
      expect(isAllowedProxyPath(`users/${UUID}/memberships`, 'GET')).toBe(true);
      expect(isAllowedProxyPath(`users/${UUID}/memberships`, 'PUT')).toBe(true);
      expect(isAllowedProxyPath('holidays', 'GET')).toBe(true);
      expect(isAllowedProxyPath('holidays', 'POST')).toBe(true);
      expect(isAllowedProxyPath(`holidays/${UUID}`, 'PATCH')).toBe(true);
      expect(isAllowedProxyPath(`holidays/${UUID}`, 'DELETE')).toBe(true);

      // Kullanıcı SİLİNMİYOR (pasife alınıyor) ve panel kullanıcı YARATMIYOR:
      // yeni personel davetle geliyor.
      expect(isAllowedProxyPath(`users/${UUID}`, 'DELETE')).toBe(false);
      expect(isAllowedProxyPath('users', 'POST')).toBe(false);
      // Üyelik ayrı bir kaynak DEĞİL: yalnız kullanıcının altında yönetiliyor.
      expect(isAllowedProxyPath('memberships', 'POST')).toBe(false);
      expect(isAllowedProxyPath(`users/${UUID}/memberships`, 'DELETE')).toBe(false);
      // Tatil kaydının tarihi ve şubesi değişmez; şubeye gömülü bir yol YOK.
      expect(isAllowedProxyPath(`branches/${UUID}/holidays`, 'GET')).toBe(false);
      expect(isAllowedProxyPath('holidays', 'PUT')).toBe(false);
      // Personel SİLİNMİYOR, pasife alınıyor.
      expect(isAllowedProxyPath(`staff/${UUID}`, 'DELETE')).toBe(false);
    });
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

    it('raporların eklenmesi PARA yüzeyini açmadı', () => {
      for (const path of ['payments', 'charges', 'packages', 'customer-packages']) {
        expect(isAllowedProxyPath(path, 'GET'), path).toBe(false);
      }
    });
  });
});
