import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, login, firstBranch, authHeaders, dayIso } from './lib.js';

/**
 * Randevu oluşturma — eşzamanlılık altında p95 < 120 ms (Batch 10.2).
 *
 * Senaryo BİLEREK aynı slotlara yarışır: VU'lar örtüşen bir slot havuzundan
 * seçim yapar. Ölçülen şey "mutlu yol ne kadar hızlı" değil, **çakışmanın
 * veritabanı seviyesinde ve bütçe içinde reddedilmesi**.
 *
 * Bu yüzden 409 BAŞARISIZLIK DEĞİLDİR ve `http_req_failed` eşiği onu
 * kapsayamaz — k6 4xx'i başarısız sayar. Çakışmalar ayrı bir sayaçta
 * toplanıyor ve eşik yalnız 5xx/zaman aşımı üzerinden kuruluyor.
 *
 * ⚠️ Bu senaryo YAZAR. Koştuğu veritabanına satır bırakır; ölçüm sonrası
 * `pnpm --filter @klinara/api db:seed:volume` ile kiracı sıfırlanmalı.
 */

const conflicts = new Counter('klinara_slot_conflicts');
const created = new Counter('klinara_appointments_created');
const serverErrors = new Counter('klinara_server_errors');

export const options = {
  scenarios: {
    contention: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
    },
  },
  thresholds: {
    // 409'lar bilinçli olarak dışarıda: `expected_response` etiketiyle
    // ayrıştırmak yerine, gerçek hataları kendi sayacımızla kapıya bağlıyoruz.
    klinara_server_errors: ['count==0'],
    http_req_duration: ['p(95)<120'],
  },
};

export function setup() {
  const token = login();
  const branchId = firstBranch(token);

  const services = http.get(`${BASE_URL}/api/v1/services`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (services.status !== 200) fail(`hizmet listesi alınamadı (${services.status})`);
  const serviceList = services.json().data;
  if (!serviceList || serviceList.length === 0) fail('hizmet yok');

  const staff = http.get(`${BASE_URL}/api/v1/staff`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (staff.status !== 200) fail(`personel listesi alınamadı (${staff.status})`);
  const staffList = staff.json().data;
  if (!staffList || staffList.length === 0) fail('personel yok');

  const customers = http.get(`${BASE_URL}/api/v1/customers?limit=50`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (customers.status !== 200) fail(`müşteri listesi alınamadı (${customers.status})`);
  const customerList = customers.json().data;
  if (!customerList || customerList.length === 0) fail('müşteri yok');

  return {
    token,
    branchId,
    serviceId: serviceList[0].id,
    staffProfileId: staffList[0].id,
    customerIds: customerList.map((c) => c.id),
  };
}

export default function createAppointment(data) {
  // 40 slotluk dar bir havuz, 10 VU: çakışma ARANIYOR.
  const slot = Math.floor(Math.random() * 40);
  const day = dayIso(60 + Math.floor(slot / 20));
  const hour = 9 + (slot % 20) / 2;
  const startsAt =
    `${day}T${String(Math.floor(hour)).padStart(2, '0')}` +
    `:${hour % 1 === 0 ? '00' : '30'}:00+03:00`;

  const res = http.post(
    `${BASE_URL}/api/v1/appointments`,
    JSON.stringify({
      branchId: data.branchId,
      customerId: data.customerIds[__VU % data.customerIds.length],
      startsAt,
      services: [{ serviceId: data.serviceId, staffProfileId: data.staffProfileId }],
    }),
    {
      headers: {
        ...authHeaders(data.token, data.branchId),
        // Her istek KENDİ anahtarını taşır: idempotency'nin tekrarı
        // yakalaması değil, yarışın gerçekten veritabanına ulaşması
        // ölçülüyor. Paylaşılan bir anahtar çakışmayı uygulama katmanında
        // yutardı.
        'idempotency-key': `k6-${__VU}-${__ITER}-${Date.now()}`,
      },
    },
  );

  if (res.status === 201) created.add(1);
  else if (res.status === 409) conflicts.add(1);
  else if (res.status >= 500) serverErrors.add(1);

  check(res, {
    'oluştu ya da çakıştı': (r) => r.status === 201 || r.status === 409,
    'sunucu hatası yok': (r) => r.status < 500,
  });
}

export function handleSummary(data) {
  const c = data.metrics.klinara_slot_conflicts?.values?.count ?? 0;
  const ok = data.metrics.klinara_appointments_created?.values?.count ?? 0;
  // Sıfır çakışma, senaryonun yeterince yarışmadığı anlamına gelir —
  // yani ölçüm hedefini ıskalamıştır. Bunu sessiz geçmek yerine yazıyoruz.
  const warning = c === 0 ? '\n⚠️  Hiç çakışma olmadı: senaryo yarışmıyor, slot havuzunu daralt.\n' : '';
  return {
    stdout: `\nOluşan: ${ok}  ·  Çakışan (beklenen): ${c}${warning}\n`,
  };
}
