import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, login, firstBranch, authHeaders, dayIso } from './lib.js';

/**
 * Uygunluk sorgusu — eşzamanlılık altında p95 < 200 ms (Batch 10.2).
 *
 * Bu senaryonun Vitest'teki p95 testinden farkı EŞZAMANLILIK. Uygunluk
 * motoru süreç-içi bir cache'in arkasında (`AvailabilityCacheService`, 30 sn
 * TTL) ve tek istemcili bir testte ikinci istekten itibaren hep cache'ten
 * döner — yani ölçülen şey motor değil, `Map.get` olur.
 *
 * Burada her VU FARKLI bir güne bakıyor. Böylece cache anahtarları ayrışıyor
 * ve motor gerçekten koşuyor. Cache'in kendi katkısını ölçmek isteyen ayrı
 * bir senaryo yazmalı; bu senaryonun sorusu "cache ıskaladığında ne oluyor".
 */

const engineDuration = new Trend('klinara_availability_ms', true);

export const options = {
  scenarios: {
    steady: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '40s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // 10.2 hedefi. Aşılırsa k6 sıfırdan farklı kodla çıkar — CI kapısı (10.4).
    'http_req_duration{scenario:steady}': ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const token = login();
  const branchId = firstBranch(token);

  const services = http.get(`${BASE_URL}/api/v1/services`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (services.status !== 200) fail(`hizmet listesi alınamadı (${services.status})`);

  const list = services.json().data;
  if (!list || list.length === 0) fail('hizmet yok — db:seed koşturuldu mu?');

  return { token, branchId, serviceId: list[0].id };
}

export default function availability(data) {
  // Her VU kendi gününe bakar: cache anahtarları ayrışsın (yukarıdaki not).
  const day = dayIso((__VU % 25) + 1);

  const res = http.get(
    `${BASE_URL}/api/v1/availability` +
      `?branchId=${data.branchId}` +
      `&serviceIds=${data.serviceId}` +
      `&from=${day}T00:00:00%2B03:00` +
      `&to=${day}T23:59:59%2B03:00`,
    { headers: authHeaders(data.token, data.branchId) },
  );

  engineDuration.add(res.timings.duration);

  check(res, {
    '200 döndü': (r) => r.status === 200,
    'slot dizisi var': (r) => r.status === 200 && Array.isArray(r.json().slots),
  });
}
