# k6 yük testleri — Batch 10.2

Vitest'teki p95 testleri **tek istemcili**dir: bir isteğin ne kadar sürdüğünü
ölçerler, eşzamanlılık altında ne olduğunu değil. İkisi farklı sorulardır ve
ikincisi ancak gerçek bir yük üreticiyle cevaplanır — havuz doygunluğu, kilit
çekişmesi ve `EXCLUDE` constraint'inin yarış davranışı yalnız burada görünür.

## Ön koşullar

```bash
brew install k6                       # ya da https://k6.io/docs/get-started/installation/
docker compose up -d postgres
pnpm --filter @klinara/api db:migrate
pnpm --filter @klinara/api db:seed:volume   # 50 şube · 200 personel · 100k randevu
pnpm --filter @klinara/api dev
```

`db:seed:volume` **`db:seed`in yerine geçmez**, yanına gelir: demo kiracı
(`demo-klinik`) web uygulamaları için, hacim kiracısı (`yuk-testi`) ölçüm için.

## Koşum

Senaryolar kimlik bilgisi gerektirir. Hacim seed'i personel hesaplarını
GEÇERSİZ parola hash'iyle açar (200 kez argon2 koşturmak seed'i dakikalarca
uzatırdı), dolayısıyla giriş için demo sahibi kullanılır:

```bash
k6 run -e BASE_URL=http://localhost:3000 \
       -e EMAIL=sahip@demo-klinik.test \
       -e PASSWORD=demo-parola-12345 \
       tools/k6/availability.js
```

`appointment-create.js` yazan bir senaryodur ve koştuğu veritabanına satır
bırakır. Ölçüm bittikten sonra `db:seed:volume` yeniden koşturulmalı — kendi
kiracısını sıfırdan kurar.

## Eşikler

`thresholds` bölümleri 10.2'nin hedefleridir ve **başarısızlık koşuludur**:
eşik aşılırsa k6 sıfırdan farklı bir kodla çıkar, yani CI'da kapı olarak
kullanılabilir (10.4).

| Senaryo | Hedef |
|---|---|
| `availability.js` | p95 < 200 ms |
| `appointment-create.js` | p95 < 120 ms, `SLOT_CONFLICT` dışında hata yok |

## Yorumlama

`appointment-create.js` bilerek aynı slotlara yarışır. **409 `SLOT_CONFLICT`
bir hata değil, beklenen sonuçtur** — testin ölçtüğü şey, çakışmanın
veritabanı seviyesinde ve p95 bütçesi içinde reddedilmesidir. Sıfır çakışma
görülüyorsa senaryo yeterince yarışmıyor demektir; 500 hatası ya da zaman
aşımı görülüyorsa gerçek bir sorun vardır.
