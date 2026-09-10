# klinara-fixtures

Native istemcilerin **paylaştığı** JSON fixture'ları.

## Neden burada?

`ANDROID_DEVELOPMENT.md` R6: "Sözleşme değişince tek istemci güncellenir." Fixture'lar
her istemcide ayrı yaşarsa, sunucu bir alan eklediğinde biri güncellenir diğeri sessizce
eskir ve mock modda iki istemci farklı davranmaya başlar.

iOS'ta bu dosyalar Swift çok satırlı string literal'i olarak duruyordu (`Fixtures.swift`
ve — auth olanlar — `MockAuthService.swift`'in içinde, yani ÜRETİM hedefinde). Buradaki
dosyalar oradan **çıkarıldı**; iOS test hedefinin de bunları bundle kaynağı olarak
okuması ayrı bir iş olarak açık.

## Kim okuyor?

- **Android:** `app/build.gradle.kts` bu dizini `test` ve `debug` kaynak kümelerine
  `resources.srcDir` ile ekliyor. Release APK tek bayt fixture taşımaz.
  Okuyucu: `com.klinara.android.services.mock.Fixtures`.
- **iOS:** (takip işi) test hedefine bundle kaynağı olarak eklenecek.

## Kural

Mock yanıtlar **gerçek JSON**'dur ve **üretim çözümleyicisiyle** (`KlinaraJson`)
çözülür. Böylece bir sözleşme kayması mock'u da kırar; elle kurulmuş nesneler kaymayı
gizlerdi.

`permissions` alanı burada TUTULMAZ: `tools/gen-client-contracts.mjs` onu
`packages/shared/src/permissions.ts`'ten üretiyor ve mock servis çalışma anında
yerleştiriyor. Elle tutulan bir izin listesi iOS'ta bir kez saptı.

## `crm/` (A4.1)

`customer-with-tags.json` kartın tam alan kümesini, `customer-page.json` imleçli
sayfayı, `customer-search.json` ise **çıplak diziyi** (zarf YOK) çiviliyor — sözleşmenin
tek istisnası odur ve iOS'ta bir kez ezberden zarf beklenip arama kırılmıştı.

`customer-forward-compatible.json` bilerek **ileri sürümlü**: tanımadığımız bir `source`
ve `gender` değeri ve fazladan bir alan taşıyor. İstemci üçünde de çökmemeli — yoksa
sunucuya eklenen tek bir yeni geliş kaynağı, on bin kayıtlık listeyi düşürürdü.

## `files/` (A4.4)

`presign-upload.json` üç adımlı akışın ilk adımını, `customer-file.json` yeni yüklenmiş
bir dosyayı (**`hasThumbnail: false`** — kuyruk işi henüz bitmedi) ve
`problem-thumb-not-ready.json` hazır olmayan küçük görselin `409`'unu çiviliyor. O `409`
bir hata değil "henüz değil" demek ve istemci **tam boyuta düşmemeli**.

## Tohum ≠ fixture (A3.1)

`booking/` altındaki dosyalar **çözümleme sözleşmesini** çiviliyor: sabit tarihlidirler
ve yalnız testler okur. Ekranı süren mock takvim verisi bir **tohumdur**
(`MockBookingSeed`), fixture değil — takvim "bugünü" göstermek zorunda ve sabit tarihli
bir JSON yarın boş bir gün gibi görünürdü.

`calendar-day-unknown-status.json` bilerek bozuk değil, bilerek **ileri sürümlü**:
tanımadığımız bir `status` ve fazladan bir alan taşıyor. İstemci ikisinde de çökmemeli.
