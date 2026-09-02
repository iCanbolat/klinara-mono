import { describe, it, expect } from 'vitest';
import { isAllowedProxyPath } from '../../src/lib/proxy-allowlist';

/**
 * Proxy'nin beyaz listesi, kimlik doğrulaması olmayan bir uçtan `/api/v1`'in
 * tamamına açılabilecek tek kapı. Bu yüzden testi davranışsal değil,
 * DÜŞMANCA: geçmesi gerekenler kadar geçmemesi gerekenler de sayılıyor.
 */
describe('proxy yol beyaz listesi', () => {
  const allowed: [string, string][] = [
    ['resolve', 'GET'],
    ['sites/demo', 'GET'],
    ['sites/demo/branches', 'GET'],
    ['sites/demo/services', 'GET'],
    ['sites/demo/staff', 'GET'],
    ['sites/demo/availability', 'GET'],
    ['sites/demo/holds', 'POST'],
    ['sites/demo/holds/abc12345/otp', 'POST'],
    ['sites/demo/holds/abc12345/otp/verify', 'POST'],
    ['sites/demo/holds/abc12345', 'DELETE'],
    ['sites/demo/appointments', 'POST'],
    ['sites/demo/appointments/tok12345', 'GET'],
    ['sites/demo/appointments/tok12345/ics', 'GET'],
    ['sites/demo/appointments/tok12345/cancel', 'POST'],
    ['sites/demo/appointments/tok12345/reschedule', 'POST'],
  ];

  it.each(allowed)('izin veriyor: %s %s', (path, method) => {
    expect(isAllowedProxyPath(path, method)).toBe(true);
  });

  const denied: [string, string, string][] = [
    ['internal/booking-domains/authorize', 'GET', 'iç kenar ucu'],
    ['../internal/booking-domains/authorize', 'GET', 'yol geçişi'],
    ['sites/demo/../../auth/login', 'POST', 'gömülü yol geçişi'],
    ['sites/demo/..%2f..%2fauth/login', 'POST', 'kodlanmış ayraç'],
    ['auth/login', 'POST', 'kimlik ucu'],
    ['users', 'GET', 'kullanıcı listesi'],
    ['customers', 'GET', 'müşteri listesi'],
    ['booking-page/content', 'PUT', 'yönetim ucu'],
    ['sites/demo//services', 'GET', 'çift eğik çizgi'],
    ['/sites/demo', 'GET', 'baştaki eğik çizgi'],
    ['sites/demo/', 'GET', 'sondaki eğik çizgi'],
    ['sites/DEMO/services', 'GET', 'büyük harfli slug'],
    ['sites/demo/services', 'DELETE', 'yanlış metot'],
    ['sites/demo/appointments', 'DELETE', 'yanlış metot'],
    ['sites/demo/holds', 'GET', 'yanlış metot'],
    ['sites/demo/staff/secret', 'GET', 'listede olmayan alt yol'],
  ];

  it.each(denied)('reddediyor: %s %s (%s)', (path, method, _why) => {
    expect(isAllowedProxyPath(path, method)).toBe(false);
  });

  it('aşırı uzun yolu reddediyor', () => {
    expect(isAllowedProxyPath(`sites/demo/${'a'.repeat(5000)}`, 'GET')).toBe(false);
  });
});
