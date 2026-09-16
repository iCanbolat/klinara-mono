/**
 * Yönetim proxy'sinin yol beyaz listesi — bu dosyanın tek işi HAYIR demek.
 *
 * `apps/web-booking/src/lib/proxy-allowlist.ts` ile aynı felsefe, ama BURADA
 * RİSK DAHA BÜYÜK: public proxy yukarı akışa `public/` önekini kendisi
 * ekliyordu, yani en kötü ihtimalde public yüzeye açılıyordu. Bu proxy ise
 * isteğe kullanıcının OTURUM TOKEN'INI ekleyip `/api/v1`'in köküne gönderiyor.
 * Buradaki bir açık, kimliği doğrulanmış bir kullanıcının tarayıcısından
 * API'nin TAMAMINA açılan bir tünel demektir.
 *
 * Bu yüzden izin veren liste var, yasaklayan değil: yeni bir uç eklendiğinde
 * buraya yazılmadıkça proxy'den geçmez — ve bu, güvenli yönde başarısız olmaktır.
 *
 * DIŞARIDA BIRAKILANLAR VE GEREKÇELERİ
 *
 * - **Token üreten/tüketen uçlar** (`auth/login`, `auth/tenant`, `auth/refresh`,
 *   `auth/logout`, `auth/2fa/verify|setup|enable`, `auth/passkey/*` TEKİL,
 *   `auth/password/forgot|reset`, `invitations/token/*`): bunların yanıtı
 *   cookie yazmayı gerektiriyor, genel proxy ise gövdeyi olduğu gibi geçiriyor.
 *   Buradan geçselerdi token tarayıcıya inerdi — yani BFF'in tek amacı çöpe
 *   giderdi. Hepsinin `app/api/session/*` altında kendi handler'ı var.
 * - **`internal/*`, `platform/*`, `webhooks/*`, `metrics`**: kiracı
 *   kullanıcısının yüzeyi değil. `internal/booking-domains/authorize` kenar
 *   proxy'sinin sertifika sorusudur, `platform/*` kiracı-üstüdür.
 * - **`public/*`**: bu uygulamanın public yüzeyi okumak için hiçbir sebebi yok;
 *   taslak önizlemenin yetkili karşılığı `booking-page/preview`.
 * - **Finans, paket, bildirim, denetim** (`payments`, `charges`, `cash`,
 *   `commission*`, `packages`, `customer-packages`, `messages`, `audit*`):
 *   Faz 12 bunların HİÇBİRİNİ istemiyor. Kural aynı: uç buraya yazılmadıkça
 *   geçmez. `consent-templates` / `consent-records` de burada: Faz 7
 *   daraltılınca o tablolar HİÇ yazılmadı, dolayısıyla o uçlar YOK.
 *
 * KLİNİK OPERASYONU — Faz 12'de AÇILDI, gerekçesi değişti
 *
 * Bu dosya Faz 11 boyunca "klinik operasyonunun TAMAMI dışarıda, çünkü
 * dışarıda tutmak BEDAVA" diyordu. O gerekçe doğruydu ve artık geçersiz:
 * panelde klinik ekranı yoktu, dolayısıyla kapalı tutmanın maliyeti sıfırdı.
 * Faz 12 takvimi, müşteri kartını ve katalogu getirdiği anda maliyet sıfır
 * olmaktan çıktı. Geçersizleşen bir gerekçeyi SİLMEK yerine neyin yerini
 * aldığını yazmak gerekiyor:
 *
 * 1. **"Görünür diff" ilkesi korunuyor ve şimdi asıl işini yapıyor.** Eski
 *    metnin değeri "şuraya bir müşteri sayfası ekleyiverelim"i güvenlik
 *    açısından kritik bir dosyada görünür kılmasıydı. Aşağıdaki satırlar tam
 *    olarak o diff'tir: ekran ekran, metot metot gerekçelendirilmiş.
 * 2. **Okuma/yazma sınırı BATCH sınırıdır.** `GET services` ve `GET staff`
 *    takvimle birlikte açıldı çünkü randevu formu onlarsız kurulamaz; yazma
 *    metotları bir batch sonra, kendi ekranlarıyla geldi. `Rule` zaten metot
 *    bazlı olduğu için bu ayrım bedava.
 * 3. **`GET customers/search` ile `GET customers` arasındaki fark bilinçli.**
 *    Arama ucu `q` için en az 2 karakter istiyor, çıplak dizi dönüyor ve
 *    sayfalama taşımıyor — yani müşteri defterinin SIRAYLA TARANMASINA izin
 *    vermiyor. Randevu formunun ihtiyacı tam olarak bu kadardı ve 12.2'de
 *    yalnız o açıldı; defterin tamamı kendi ekranıyla (12.3) geldi.
 * 4. **Önek jokeri YOK ve olmayacak.** `appointments/`, `customers/`,
 *    `staff/` öneklerine joker vermek, yarın eklenecek bir alt ucu sessizce
 *    açardı. Raporlar için yazılan aynı cümle burada daha da geçerli, çünkü
 *    bu yollar YAZIYOR.
 *
 * ⚠️ BEYAZ LİSTE YALNIZ YOLU DENETLER. Sorgu dizgesi (`?branchId=`, `?q=`,
 * `?cursor=`) `request.nextUrl.search` üzerinden yukarı akışa OLDUĞU GİBİ
 * gider ve burada hiç görülmez. Denetimi API yapıyor: parametreler
 * `class-validator` DTO'larından, kapsam ise `BranchAccessService`ten geçiyor.
 * Bu kabul edilebilir ama yazılı olmalı — özellikle `?branchId` gibi KAPSAM
 * BELİRLEYEN bir parametrenin doğrulandığı yerin burası olmadığı.
 *
 * Her kuralın `test/unit/proxy-allowlist.test.ts`te üç vakası var: izinli
 * metot pozitifi, izinsiz metot negatifi, kardeş yol negatifi.
 *
 * RAPORLAR (10.1) — yukarıdaki kuralın İSTİSNASI DEĞİL, TANIMININ DIŞI
 *
 * `reports/*` listede ve olması gerekiyor. Klinik operasyonunu dışarıda tutma
 * gerekçesi "yazma yüzeyini ve müşteri kaydını panele açmayalım"dı; rapor
 * uçları ikisini de yapmıyor:
 *
 * - Hepsi SALT OKUNUR. `POST .../export`in gövdesi bir kayıt değil bir filtre;
 *   sunucuda hiçbir şey yazmıyor (dinamik `:name` yolu da yok, her rapor kendi
 *   statik iznini taşıyor).
 * - Yanıtlar TOPLU. Müşteri kimliği, telefonu, notu dönmüyor; retention raporu
 *   bunu bir testle sabitliyor.
 * - Daraltma sunucuda: şube üyeliği ve `report.performance:read.own` kilidi
 *   `report-scope.ts`te, proxy'nin bileceği bir şey değil.
 *
 * Yani buradaki satırlar bir müşteri sayfasına giden kapıyı aralamıyor. Tek
 * tek yazılmalarının sebebi de bu: `reports/` önekine joker vermek, yarın
 * eklenecek bir `reports/customers/:id` ucunu sessizce açardı.
 *
 * TEK İSTİSNA: `GET service-categories`
 *
 * `serviceList` bloğu kategori kimlikleriyle süzülüyor ve editörün o kimlikleri
 * bir ADLA eşleştirmesi gerekiyor — aksi hâlde kullanıcıdan UUID yazması
 * istenirdi. İstisna dar tutuldu ve öyle kalmalı: YALNIZ `GET`, YALNIZ
 * kategoriler; `services` (fiyat, süre, personel yetkinliği) listede DEĞİL,
 * çünkü blok hizmetleri değil kategorileri süzüyor. Uç `service:read` istiyor;
 * bu izni taşımayan kullanıcı 403 alır ve editör mevcut seçimi salt okunur
 * gösterir — kategori listesini görememek, seçimi SİLMEK demek değildir.
 */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

interface Rule {
  methods: readonly string[];
  pattern: RegExp;
}

const RULES: readonly Rule[] = [
  // --- Kimlik: yalnız oturum AÇILDIKTAN sonraki, token üretmeyen uçlar ---
  { methods: ['GET', 'PATCH'], pattern: /^me$/ },
  { methods: ['GET'], pattern: /^branches$/ },
  // Şube yönetimi ("Şube ve Personel"). Yalnız `branch:write` (owner); SİLME
  // UCU YOK — pasife alma `PATCH { isActive: false }`.
  { methods: ['POST'], pattern: /^branches$/ },
  { methods: ['PATCH'], pattern: new RegExp(`^branches/${UUID}$`) },
  { methods: ['GET'], pattern: /^auth\/sessions$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^auth/sessions/${UUID}$`) },
  { methods: ['POST'], pattern: /^auth\/logout-all$/ },
  { methods: ['POST'], pattern: /^auth\/password\/change$/ },

  // 2FA yönetimi — `verify`, `setup` ve `enable` BURADA YOK (challenge token'ı
  // Bearer olarak kabul ediyorlar, yani cookie'den okunmaları gerekiyor).
  { methods: ['GET', 'DELETE'], pattern: /^auth\/2fa$/ },
  { methods: ['POST'], pattern: /^auth\/2fa\/backup-codes$/ },

  // Passkey KAYDI (çoğul `passkeys`) — oturum açıkken yapılır, token üretmez.
  // Passkey ile GİRİŞ (tekil `passkey`) bilerek dışarıda.
  { methods: ['POST'], pattern: /^auth\/passkeys\/register\/options$/ },
  { methods: ['POST'], pattern: /^auth\/passkeys\/register$/ },
  { methods: ['GET'], pattern: /^auth\/passkeys$/ },
  { methods: ['PATCH', 'DELETE'], pattern: new RegExp(`^auth/passkeys/${UUID}$`) },

  // --- Davetler (yönetim tarafı; token ile kabul akışı dışarıda) ---
  { methods: ['GET', 'POST'], pattern: /^invitations$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^invitations/${UUID}$`) },

  // --- Katalog: yalnız kategori ADLARI (yukarıdaki tek istisna) ---
  { methods: ['GET'], pattern: /^service-categories$/ },

  // --- Raporlar (10.1): salt okunur, toplu veri ---
  // Şube seçici `GET branches`i kullanıyor; o zaten listede.
  {
    methods: ['GET'],
    pattern: /^reports\/(occupancy|revenue|staff-performance|no-show|retention)$/,
  },
  { methods: ['GET'], pattern: /^reports\/packages\/(outstanding|expiring|usage)$/ },
  // CSV indirme. `POST` ama yazmıyor — gövde filtre taşıyor, kayıt değil.
  {
    methods: ['POST'],
    pattern: /^reports\/(occupancy|revenue|staff-performance|no-show|retention)\/export$/,
  },

  // --- Randevu sayfası: Faz 11.5 ve 11.6'nın tüm yüzeyi ---
  { methods: ['GET', 'PUT'], pattern: /^booking-page$/ },
  { methods: ['GET', 'PUT'], pattern: /^booking-page\/content$/ },
  { methods: ['GET'], pattern: /^booking-page\/content\/revisions$/ },
  { methods: ['POST'], pattern: new RegExp(`^booking-page/content/rollback/${UUID}$`) },
  { methods: ['GET'], pattern: /^booking-page\/preview$/ },
  { methods: ['POST'], pattern: /^booking-page\/(publish|unpublish)$/ },

  { methods: ['GET'], pattern: /^booking-page\/assets$/ },
  { methods: ['POST'], pattern: /^booking-page\/assets\/(presign|confirm)$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^booking-page/assets/${UUID}$`) },

  // --- Onam metni (Faz 7) ---
  // Yalnız `consent-document*` ve `consent-acceptances`. `consent-templates` /
  // `consent-records` KAPALI kalıyor: Faz 7 daraltılınca hiç yazılmadılar.
  { methods: ['GET'], pattern: /^consent-document$/ },
  { methods: ['PUT'], pattern: /^consent-document\/draft$/ },
  { methods: ['POST'], pattern: /^consent-document\/publish$/ },
  { methods: ['GET'], pattern: /^consent-document\/versions$/ },
  { methods: ['GET'], pattern: /^consent-acceptances$/ },

  { methods: ['GET', 'POST'], pattern: /^booking-page\/domains$/ },
  { methods: ['DELETE'], pattern: new RegExp(`^booking-page/domains/${UUID}$`) },
  { methods: ['POST'], pattern: new RegExp(`^booking-page/domains/${UUID}/(verify|primary)$`) },

  // --- Takvim ve randevu (12.2) ---
  // Bu blok, klinik operasyonuna açılan İLK kapı. Yukarıdaki başlık yorumunun
  // "KLİNİK OPERASYONU" bölümü neden ve hangi sınırlarla açıldığını anlatıyor.
  { methods: ['GET', 'POST'], pattern: /^appointments$/ },
  { methods: ['GET', 'PATCH'], pattern: new RegExp(`^appointments/${UUID}$`) },
  { methods: ['GET'], pattern: new RegExp(`^appointments/${UUID}/history$`) },
  // Üç eylem tek satırda: hepsi aynı kaydı, aynı izinle (`appointment:write`)
  // değiştiriyor. `DELETE` YOK — randevu silinmez, iptal edilir.
  {
    methods: ['POST'],
    pattern: new RegExp(`^appointments/${UUID}/(reschedule|cancel|status)$`),
  },
  { methods: ['GET'], pattern: /^availability$/ },
  { methods: ['GET'], pattern: /^calendar\/(day|week|staff)$/ },

  // Randevu formunun OKUMA yüzeyi. Yazma metotları 12.4'te, kendi
  // ekranlarıyla birlikte açılıyor.
  { methods: ['GET'], pattern: /^services$/ },
  { methods: ['GET'], pattern: new RegExp(`^services/${UUID}$`) },
  { methods: ['GET'], pattern: /^staff$/ },
  { methods: ['GET'], pattern: new RegExp(`^staff/${UUID}$`) },

  // Müşteri defterinin EN DAR kapısı: `q` en az 2 karakter, çıplak dizi,
  // sayfalama yok — defter SIRAYLA TARANAMAZ.
  { methods: ['GET'], pattern: /^customers\/search$/ },

  // --- Müşteri kartı (12.3) ---
  // Defterin tamamı burada açılıyor. 12.2 yalnız aramayı açmıştı; ayrım
  // bilinçliydi ve kaydı burada duruyor (başlık yorumu, madde 3).
  { methods: ['GET', 'POST'], pattern: /^customers$/ },
  { methods: ['GET', 'PATCH', 'DELETE'], pattern: new RegExp(`^customers/${UUID}$`) },
  { methods: ['PUT'], pattern: new RegExp(`^customers/${UUID}/tags$`) },
  // Birleştirme YIKICI ve geri alınamaz; kendi izniyle (`customer:merge`)
  // korunuyor ve arayüz yazarak onay istiyor.
  { methods: ['POST'], pattern: new RegExp(`^customers/${UUID}/merge$`) },
  { methods: ['GET', 'POST'], pattern: /^customer-tags$/ },
  { methods: ['PATCH', 'DELETE'], pattern: new RegExp(`^customer-tags/${UUID}$`) },

  { methods: ['GET', 'POST'], pattern: new RegExp(`^customers/${UUID}/notes$`) },
  { methods: ['PATCH', 'DELETE'], pattern: new RegExp(`^notes/${UUID}$`) },
  { methods: ['GET'], pattern: new RegExp(`^notes/${UUID}/revisions$`) },
  { methods: ['GET'], pattern: new RegExp(`^customers/${UUID}/timeline$`) },

  // Dosyalar. ⚠️ `download-url` HER ÇAĞRIDA KVKK erişim kaydı yazıyor;
  // istemci onu liste render'ında değil, yalnız kullanıcı indirme/önizleme
  // eylemini tetiklediğinde çekiyor.
  { methods: ['POST'], pattern: /^uploads\/presign$/ },
  { methods: ['GET', 'POST'], pattern: new RegExp(`^customers/${UUID}/files$`) },
  { methods: ['GET', 'POST'], pattern: new RegExp(`^customers/${UUID}/file-groups$`) },
  { methods: ['GET'], pattern: new RegExp(`^files/${UUID}/download-url$`) },
  { methods: ['DELETE'], pattern: new RegExp(`^files/${UUID}$`) },

  // --- Katalog YAZMA (12.4); okuma 12.2'de, `GET service-categories` yukarıda ---
  { methods: ['POST'], pattern: /^services$/ },
  { methods: ['PATCH', 'DELETE'], pattern: new RegExp(`^services/${UUID}$`) },
  { methods: ['POST'], pattern: /^service-categories$/ },
  { methods: ['PATCH', 'DELETE'], pattern: new RegExp(`^service-categories/${UUID}$`) },

  // --- Personel YAZMA (12.4) ---
  { methods: ['POST'], pattern: /^staff$/ },
  { methods: ['PATCH'], pattern: new RegExp(`^staff/${UUID}$`) },
  // Yetkinlik matrisi — TAM DEĞİŞTİRME.
  { methods: ['PUT'], pattern: new RegExp(`^staff/${UUID}/services$`) },
  // Personel oluşturma MEVCUT bir `userId` istiyor; kullanıcı listesi
  // olmadan form kurulamaz. `PATCH users/:id` yalnız ad/dil/aktiflik
  // değiştiriyor.
  { methods: ['GET'], pattern: /^users$/ },
  { methods: ['GET', 'PATCH'], pattern: new RegExp(`^users/${UUID}$`) },
  // Rol değiştirme (Faz 1'den devreden madde kapandı). `PUT` TAM DEĞİŞTİRİR
  // ve boş liste kullanıcıyı klinikten çıkarır; sunucu yetki yükseltmeyi,
  // kendi rolüne dokunmayı ve son sahibi kaldırmayı ayrıca reddediyor.
  { methods: ['GET', 'PUT'], pattern: new RegExp(`^users/${UUID}/memberships$`) },

  // --- Çalışma planı (12.4) — hepsi `X-Branch-Id` istiyor ---
  { methods: ['GET', 'PUT'], pattern: new RegExp(`^branches/${UUID}/hours$`) },
  { methods: ['GET', 'PUT'], pattern: new RegExp(`^staff/${UUID}/schedule$`) },
  { methods: ['GET', 'POST'], pattern: /^schedule-exceptions$/ },
  // `PATCH` YOK ÇÜNKÜ UÇ YOK: düzenleme = kaldır + yeniden ekle.
  { methods: ['DELETE'], pattern: new RegExp(`^schedule-exceptions/${UUID}$`) },

  // Tatiller (Faz 3'ten devreden madde kapandı). İstisnaların aksine burada
  // `PATCH` VAR: tatilin adı ve saatleri değişebilir, tarihi ve şubesi
  // değişemez — başka bir gün, başka bir kayıttır.
  { methods: ['GET', 'POST'], pattern: /^holidays$/ },
  { methods: ['PATCH', 'DELETE'], pattern: new RegExp(`^holidays/${UUID}$`) },
];

/**
 * Verilen yol + metot proxy'den geçebilir mi?
 *
 * `path` `/api/a/` önekinden SONRAKİ kısımdır ve API'nin `/api/v1` önekini
 * İÇERMEZ — onu proxy ekler.
 */
export function isAllowedProxyPath(path: string, method: string): boolean {
  // Yol geçişi, çift eğik çizgi, kodlanmış ayraç: hepsi burada ölür.
  // Normalize edip doğrulamak yerine reddediyoruz — normalize edilmiş bir yolu
  // doğrulamak, doğrulanmış bir yolu normalize etmekten daha kırılgan.
  // (`apps/web-booking/src/lib/proxy-allowlist.ts` ile birebir aynı savunma.)
  if (path.includes('..') || path.includes('//') || path.includes('\\')) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  if (/%2f|%5c|%2e/i.test(path)) return false;
  if (path.length > 4096) return false;

  const upperMethod = method.toUpperCase();
  return RULES.some((rule) => rule.methods.includes(upperMethod) && rule.pattern.test(path));
}
