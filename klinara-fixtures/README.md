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

## `packages/` (A5)

`package-definition.json` çok kalemli ve indirimli tanımı çiviliyor: `revision` ile
`version` bilerek FARKLI — ikisi iki ayrı sayaç ve eşit olsalardı karıştırıldıkları hiç
görünmezdi. `package-definition-page.json` imleçli sayfayı, **`validityDays: null`**
(süresiz — `0` değil) ve ileri sürümlü bir alanı taşıyor.

`customer-package.json` kalem bazlı bakiyeyi (lazer 6/10, bakım 1/2) ve satış tahsisini
taşıyor; `customer-package-page.json`'daki iade edilmiş paket **kasa hareketi bekleyen**
(`refundSettlementStatus: "pending"`) bir yükümlülük. `package-ledger.json` bir tüketimi
ve onu geri alan **ters kaydı** (`reversesEntryId`) taşıyor; `ledger-unknown-kind.json`
bilerek tanımadığımız bir `entryType` içeriyor. `package-entitlements.json` **çıplak
dizi** — zarf YOK.

Raporlar: `outstanding-report.json` silinmiş bir kırılımın **`groupId: null`** hâlini;
`expiring-report-no-revenue.json` `report.revenue:read` olmayan rolün yanıtını taşıyor —
bir satırda açık `"outstandingMinor": null`, diğerinde alan HİÇ yok. İkisi de ekranda
"—" olmalı, "0 ₺" değil. `usage-report.json` dönem kullanımını.

## `catalog/` (A7.1)

`service.json` şube farkı taşıyan bir hizmeti çiviliyor: override'daki **`null` alanlar
miras** demek (sıfır değil) ve `isOnlineBookable: false` şubede online'ı kapatıyor.
`service-category.json` pasif bir kategori; `services-list.json` liste zarfını, açık
`null` açıklama/rengi ve ileri sürümlü bir alanı (`requiresConsent`) taşıyor.

## `staff/` (A7.2)

`staff-profile.json` aynı hizmet için **iki şube kapsamı** (kiracı geneli + Bodrum, özel
süre/fiyatlı) ve bir **pasif** yetkinlik taşıyor — matris taslağının kayıpsızlık testi
bunun üzerinde. `users-list.json` davet bekleyen (`hasPassword: false`) bir kullanıcı.

`staff-profile.json` ayrıca `branchIds` taşıyor (A7.4–A7.5): kişinin **aktif şube üyeliklerinin**
şubeleri — ana şube (Bodrum) ile üyelik şubeleri (Nişantaşı + Bodrum) bilerek örtüşüyor.
`GET staff?branchId=` bu küme VEYA `primaryBranchId` ile süzer.

`user-memberships.json` (`GET users/:id/memberships`) iki farklı şubede iki şube rolü ve
bir **kiracı kapsamlı** rol (`branchId: null`) — editör kiracı kapsamlı satırda şube
seçicisi göstermemeli. `invitations-list.json` biri şube, biri kiracı kapsamlı iki bekleyen
davet. `problem-role-escalation.json` rütbe ihlalinin `403`'ü; ekran `title`ı gösterir.

## `branches/` (A7.4)

`branches-detail.json` `GET branches`in **tam** şekli (`slug`, `phone`, `createdAt`) ve
bir **pasif** şube (Kadıköy) — liste pasif şubeyi rozetle göstermeli, şube menüsü
göstermemeli. `branch-created.json` `POST branches` `201` gövdesi,
`problem-slug-taken.json` aynı kodla ikinci şubenin `409`'u (alan hatası DEĞİL; ekran
slug alanının altına taşır).

## `scheduling/` (A7.3)

`branch-hours.json` sunucunun **`HH:mm:ss`** biçimini (istemci `HH:mm` gönderir), kapalı
Pazar'ı (saatler `null`) ve molasız Cumartesi'yi çiviliyor. `staff-schedule.json` Çarşamba
izinli bir hafta. `schedule-exceptions.json` offset'li (`+03:00`) haftalık, iki haftada bir
bir istisna ile bilerek **ileri sürümlü** bir kayıt taşıyor: tanımadığımız `recurrenceType`
(`monthly`) ve fazladan bir alan — liste çökmemeli.

## `notifications/` (A8)

iOS `NotificationFixtures.swift`'ten **aynen** çıkarıldı — gövdeler sunucudan yakalanmış.
`message-page.json` `{ data, pageInfo }` zarfı ve maskeli alıcı (`+90********67`),
`appointment-notifications.json` çıplak dizi (zarf YOK). Şablon ve tercih dosyaları
kod varsayılanını (`id: null`, `isDefault: true`) ve kiracı satırını ayrı ayrı çiviliyor;
`problem-template-invalid.json`'ın `detail`'i izinli değişkenleri sayıyor — ekran onu
gösteriyor, tablo metnini değil.

## `integrations/` (A8.3)

iOS `NotificationFixtures.swift`'ten. `whatsapp-account-active.json` yalnız **maskeli** token
taşıyor (`accessToken` anahtarı hiç yok — test bunu da doğruluyor); şablon durumu küçük harf.

## `reports/` (A9)

Yerel API'den (seed, `sahip@demo-klinik.test`) **yakalandı**; iOS'ta rapor fixture'ı yoktu.
`occupancy.json` ve `no-show.json` `compareTo=previous` ile alındı: `delta`'da `null`
(kıyaslanamaz — önceki dönem 0) ile `0` (değişim yok) yan yana duruyor ve ikisi ayrı
çözülmeli. `occupancy-by-day.json` gün kırılımının `groupId: null` hâli; `revenue-by-method.json`
tahakkuk sütununun yöntem kırılımında 0 olduğunu, `staff-performance-own.json` uygulayıcı
rolünün `scope: own` yanıtını çiviliyor. Bugünkü sunucu `pageInfo`'yu her yanıtta gönderiyor ama
bu dosyalarda alan yok: model onu opsiyonel tutuyor, alanı taşımayan yanıt da çözülmeli.
