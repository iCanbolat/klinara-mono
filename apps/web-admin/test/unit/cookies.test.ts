import { describe, expect, it } from 'vitest';
import {
  accessCookie,
  challengeCookie,
  clearAll,
  clearChallenge,
  COOKIE_NAMES,
  CHALLENGE_MAX_AGE_SECONDS,
  isExpired,
  needsRefresh,
  REFRESH_MAX_AGE_SECONDS,
  refreshCookie,
  SESSION_PATH,
} from '../../src/lib/session/cookies';

/**
 * Bu dosya bu uygulamanın en kritik güvenlik özelliğini test ediyor ve bunu
 * bir HTTP isteği ayağa kaldırmadan yapıyor — şartname saf olduğu için.
 */
describe('oturum cookie şartnamesi', () => {
  const all = [accessCookie('m1'), refreshCookie('m2'), challengeCookie('m3')];

  it('ÜÇ cookie de httpOnly', () => {
    // BFF mimarisinin tamamı buna dayanıyor: tarayıcı JS'inin okuyabildiği bir
    // oturum cookie'si olsaydı XSS ile token çalınabilirdi.
    for (const cookie of all) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
    }
  });

  it('yenileme ve challenge cookie’leri YALNIZ /api/session yolunda taşınıyor', () => {
    // En değerli iki sır, sayfa gezinmelerine ve yüzlerce /api/a/* çağrısına
    // hiç eklenmiyor.
    expect(refreshCookie('m').path).toBe(SESSION_PATH);
    expect(challengeCookie('m').path).toBe(SESSION_PATH);
    expect(accessCookie('m').path).toBe('/');
  });

  it('yenileme ve challenge SameSite=Strict, erişim Lax', () => {
    // Erişim cookie'si `Lax` olmalı: kullanıcı adres çubuğuna panel adresini
    // yapıştırdığında middleware cookie'yi görmezse gereksiz yere girişe düşer.
    expect(refreshCookie('m').sameSite).toBe('strict');
    expect(challengeCookie('m').sameSite).toBe('strict');
    expect(accessCookie('m').sameSite).toBe('lax');
  });

  it('erişim cookie’sinin Max-Age’i YOK — süre mühürlü exp’te', () => {
    expect(accessCookie('m').maxAge).toBeUndefined();
    expect(refreshCookie('m').maxAge).toBe(REFRESH_MAX_AGE_SECONDS);
    // Challenge ömrü sunucunun `JWT_CHALLENGE_TTL=5m` değeriyle aynı olmalı.
    expect(challengeCookie('m').maxAge).toBe(CHALLENGE_MAX_AGE_SECONDS);
    expect(CHALLENGE_MAX_AGE_SECONDS).toBe(300);
  });

  it('silme şartnamesi cookie’nin KENDİ yolunu kullanıyor', () => {
    // Tarayıcı cookie'yi (ad, alan adı, yol) üçlüsüyle kimliklendirir; `/`
    // yolundan gönderilen bir silme `/api/session`daki cookie'ye DOKUNMAZ.
    // Bu sessiz başarısızlık "çıkış yaptım ama oturum duruyor" demekti.
    const cleared = clearAll();
    const byName = new Map(cleared.map((cookie) => [cookie.name, cookie]));
    expect(byName.get(COOKIE_NAMES.access)?.path).toBe('/');
    expect(byName.get(COOKIE_NAMES.refresh)?.path).toBe(SESSION_PATH);
    expect(byName.get(COOKIE_NAMES.challenge)?.path).toBe(SESSION_PATH);
    for (const cookie of cleared) {
      expect(cookie.maxAge, cookie.name).toBe(0);
      expect(cookie.value, cookie.name).toBe('');
      expect(cookie.httpOnly, cookie.name).toBe(true);
    }
    expect(cleared).toHaveLength(3);
  });

  it('challenge tek başına silinebiliyor ve doğru yolu kullanıyor', () => {
    expect(clearChallenge().name).toBe(COOKIE_NAMES.challenge);
    expect(clearChallenge().path).toBe(SESSION_PATH);
    expect(clearChallenge().maxAge).toBe(0);
  });

  it('cookie adları birbirinden ayrı', () => {
    expect(new Set(Object.values(COOKIE_NAMES)).size).toBe(3);
  });

  it('needsRefresh eşiği 60 saniye ÖNCEDEN tetikleniyor', () => {
    const now = 1_700_000_000_000;
    const nowSeconds = now / 1000;
    // Proaktif yenileme: token ölmeden önce tazelensin ki kullanıcı 401
    // görmesin.
    expect(needsRefresh({ exp: nowSeconds + 61 }, now)).toBe(false);
    expect(needsRefresh({ exp: nowSeconds + 59 }, now)).toBe(true);
    expect(needsRefresh({ exp: nowSeconds - 1 }, now)).toBe(true);
  });

  it('isExpired yalnız GERÇEKTEN geçmiş token için doğru', () => {
    const now = 1_700_000_000_000;
    const nowSeconds = now / 1000;
    expect(isExpired({ exp: nowSeconds + 1 }, now)).toBe(false);
    expect(isExpired({ exp: nowSeconds }, now)).toBe(true);
    // Yenilenmesi gereken bir token henüz "geçmiş" değil — middleware bu ikisini
    // ayırmak zorunda, yoksa taze oturumu girişe düşürür.
    expect(needsRefresh({ exp: nowSeconds + 30 }, now)).toBe(true);
    expect(isExpired({ exp: nowSeconds + 30 }, now)).toBe(false);
  });
});
