import http from 'k6/http';
import { fail } from 'k6';

/**
 * İki senaryonun paylaştığı kurulum.
 *
 * Giriş `setup()` içinde BİR KEZ yapılır ve token tüm sanal kullanıcılara
 * dağıtılır. VU başına giriş yapmak, ölçülen şeyi bozardı: argon2 bilerek
 * pahalıdır (~50 ms) ve yük profiline giriş maliyetini karıştırmak,
 * uygunluk sorgusunun p95'ini ölçtüğümüz iddiasını geçersiz kılar.
 */

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL || 'sahip@demo-klinik.test';
const PASSWORD = __ENV.PASSWORD || 'demo-parola-12345';

export function login() {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'content-type': 'application/json' } },
  );

  if (res.status !== 200) {
    fail(`giriş başarısız (${res.status}): ${res.body}`);
  }

  const body = res.json();

  // Sahip birden çok kiracıda olabilir; o hâlde sunucu önce kiracı seçimi
  // ister ve `accessToken` yerine bir challenge token'ı döner.
  if (body.status === 'tenant_selection_required') {
    fail('hesap birden çok kiracıda; k6 senaryoları tek kiracılı hesap bekliyor');
  }
  if (!body.accessToken) {
    fail(`yanıtta accessToken yok: ${res.body}`);
  }

  return body.accessToken;
}

/** Sahibin erişebildiği ilk şube — senaryolar bunu kapsam olarak kullanır. */
export function firstBranch(token) {
  const res = http.get(`${BASE_URL}/api/v1/branches`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) fail(`şube listesi alınamadı (${res.status})`);

  const branches = res.json().data;
  if (!branches || branches.length === 0) fail('şube yok — db:seed koşturuldu mu?');
  return branches[0].id;
}

export function authHeaders(token, branchId) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-branch-id': branchId,
  };
}

/** `YYYY-MM-DD`, bugünden `offset` gün sonrası. */
export function dayIso(offset) {
  const date = new Date(Date.now() + offset * 86_400_000);
  return date.toISOString().slice(0, 10);
}
