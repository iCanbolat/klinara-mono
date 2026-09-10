# Batch notları

Her batch'in kapanış notu. Sapmalar, yeni bağımlılıkların gerekçesi ve iOS ile
kasıtlı farklar burada tutulur (`.claude/ANDROID_DEVELOPMENT.md` §7.7, §7.8).

---

## A0.1 — Proje iskeleti ve derleme hattı ✅

**Durum:** `./gradlew check` yeşil (derleme + ktlint + detekt + lint + 2 birim testi).
Debug APK emülatörde (API 37) açılıyor, release R8 + kaynak küçültme + desugaring geçiyor.

### Plandan sapmalar

**1. `org.jetbrains.kotlin.android` eklentisi kaldırıldı.**
AGP 9.2.1 Kotlin desteğini yerleşik getiriyor ve ayrı eklentiyi açıkça reddediyor
(`The 'org.jetbrains.kotlin.android' plugin is no longer required for Kotlin support since AGP 9.0`).
Kotlin sürümü artık AGP'den geliyor; `libs.versions.toml`'daki `kotlin` sürümü yalnız
`plugin.compose` ve `plugin.serialization` için kullanılıyor.

**2. `androidx.core:core-ktx` 1.19.0 → 1.18.0, `androidx.lifecycle` 2.11.0 → 2.10.0.**
Her ikisi de `compileSdk 37` gerektiriyor; bu makinede kurulu tek platform `android-36.1`.
Sürüm satırlarına gerekçe yorum olarak yazıldı. **Takip işi:** SDK Manager'dan
"Android 37" platformu kurulduğunda ikisi de geri yükseltilebilir.

**3. `compileSdkMinor = 1` çalıştı** — `android-36` indirmeye çalışmadan `android-36.1`
çözüldü. Planın "en olası tökezleme noktası" olarak işaretlediği yol kapanmadı;
`cmdline-tools` kurmaya gerek kalmadı.

**4. detekt 1.23.8 Kotlin 2.3 kaynağını sorunsuz ayrıştırdı.** Plandaki "patlarsa
A0.1'den çıkar" kaçış yolu kullanılmadı; detekt kapıda kalıyor.

**5. Lint'te sürüm-güncelleme kontrolleri kapatıldı**
(`GradleDependency`, `NewerVersionAvailable`, `AndroidGradlePluginVersion`, `OldTargetApi`).
Bunlar ağdan sürüm listesi çekiyor: biz hiçbir şey değiştirmesek de yarın yeni bir
kütüphane yayınlandığında derleme kırmızıya döner ve proje çevrimdışı derlenemez.
Bir kalite kapısı deterministik olmalı. Sürüm yükseltmesi bilinçli bir iştir ve
`libs.versions.toml` elle, batch notuyla güncellenir.

**6. `android:screenOrientation="portrait"` kaldırıldı.**
`targetSdk 36` (Android 16) sabit yönlendirmeyi zaten yok sayıyor (`DiscouragedApi`).
Tutmak, olmayan bir garantiyi varmış gibi göstermek olurdu. `configChanges` yerinde;
döndürmede veri kaybı olmaması A10'un denetim maddesi. **iOS ile kasıtlı fark**
(§7.8): iOS portre-only, Android değil.

**7. `LockedOrientationActivity` lint kontrolü kapatıldı** — 6 numaradan sonra
tetiklenmiyor ama gelecekte biri kilidi geri koyarsa gerekçe orada duruyor.

### Yeni bağımlılıklar (§7.7)

| Bağımlılık | Gerekçe |
|---|---|
| `androidx.core:core-splashscreen` | A1.1'de `setKeepOnScreenCondition` ile 450 ms oturum çözümleme boşluğunu sistem splash'i örter; özel LaunchScreen parlaması olmaz. Katalogda tanımlı, henüz kullanılmıyor. |
| `desugar_jdk_libs` | `java.time` API 26'da (§3). Not: tzdb cihazdan değil kütüphaneden gelir. |
| `junit-jupiter` + `junit-platform-launcher` | Ayrı JUnit5 Gradle eklentisine gerek yok; `useJUnitPlatform()` + `testRuntimeOnly(launcher)` yetiyor. |

### Bilinmesi gerekenler

- **JDK:** PATH'te java 25 varken `./gradlew` çalışıyor. Daemon
  `gradle/gradle-daemon-jvm.properties` ile 21'e pinli. Makinedeki JBR'yi bulması için
  `~/.gradle/gradle.properties`'e (commit edilmez) şu satır eklendi:
  `org.gradle.java.installations.paths=/Applications/Android Studio.app/Contents/jbr/Contents/Home`
- **CI:** `local.properties` gitignore'lu, bu yüzden CI `ANDROID_SDK_ROOT` export etmek
  zorunda. (A11 ön notu.)
- **Fiziksel cihaz:** `adb reverse tcp:3000 tcp:3000` + `local.properties`'e
  `klinara.apiBaseUrl=http://localhost:3000/api/v1`. `network_security_config` yalnız
  `10.0.2.2`, `localhost`, `127.0.0.1` tanır — LAN IP'si bilerek yok.
- **Monorepo:** `.prettierignore` ve `eslint.config.js` `klinara-android`'i hariç tutuyor,
  aksi hâlde `pnpm lint` Gradle çıktısını yürüyordu.

---

## A0.2 — Tasarım sistemi: token'lar ve tema ✅

**Durum:** `./gradlew check` yeşil. Token galerisi emülatörde açık ve koyu temada
doğru; `fontScale 2.0`'da metin sarıyor, kırpılma yok. Dokuz tipografi stili
hedeflenen ağırlıkta çiziliyor.

### Variable font tuzağı — doğrulandı ve kapatıldı

`Manrope-Variable.ttf`'in `fvar` tablosu okundu: `wght` ekseni **min 200 / varsayılan
200 / max 800**. Yani `FontFamily(Font(R.font.manrope_variable))` yazmak tüm arayüzü
ExtraLight çizerdi ve bu bir tasarım tercihi gibi göründüğü için incelemeden geçerdi.
Her yüz `FontVariation.Settings(FontVariation.weight(...))` ile açıkça veriliyor;
galeri ekranında Regular → Medium → SemiBold gözle ayrışıyor.

`FontVariation.Settings` hâlâ `@ExperimentalTextApi`; `allWarningsAsErrors = true`
olduğu için tek kullanım yerinde (`KlinaraType.manrope`) `@OptIn` gerekti.

### Çalışma zamanı font fallback'i YOK

iOS'ta `UIFont(name:)` nil dönebildiği için sisteme düşme mekanizması var. Android'de
`R.font.x` derleme zamanında ya vardır ya proje derlenmez — o fallback ölü koddur.
Yerine `verifyBrandFonts` Gradle görevi `preBuild`'e bağlandı. **Doğrulandı:** font
dosyası silinince derleme Türkçe mesajla kırılıyor.

### Düzeltilen iki hata

**1. Sistem çubuklarının arkası açık kalıyordu.** Zemin `windowInsetsPadding`'in
*içine* boyanıyordu; koyu temada üstte ve altta beyaz bantlar oluşuyordu. Zemin artık
`KlinaraTheme`'in kendi `Surface`'inde **tam kanamalı** boyanıyor, inset dolgusunu
ekranlar kendisi uyguluyor.

**2. Koyu temada soğuk açılış parlaması.** `values-night/` altına `themes.xml` ve
`colors.xml` eklendi; sistem splash zemini artık `KlinaraColors.surface`'in koyu
karşılığı, Compose'a geçişte renk sıçraması yok.

### Dokümana işlenecek düzeltme

§5.6 renk tablosu 11 token için 9 satır taşıyor. `Assets.xcassets`'ten çıkarılan
eksikler: **`borderFocus`** = `#7F9A76` / `#9DB894` (yani `sage`'in takma adı, ayrı
bir değer değil) ve **`disabled`** = `#EDE9E3` / `#2A2E2C`.

### Kararlar

- **Renkler `staticCompositionLocalOf`**, ölçü ve tipografi **düz `object`**.
  İkincisi temaya göre değişmiyor; CompositionLocal saf dolaylılık olur ve
  `Modifier.padding(KlinaraMetrics.md)`'yi composable olmayan yardımcılarda yazmayı
  engellerdi.
- **Türetilmiş opaklıklar extension property** (`dangerSurface`, `trackBorder`, …),
  tablo satırı değil. Taban token'ın deterministik fonksiyonu; tabloya yazmak
  light/dark satırlarını ikiye katlar ve iki drift noktası yaratır.
- **Material3 yalnız taşıyıcı.** `ColorScheme` token'larla dolduruldu ki ripple,
  imleç, `Snackbar` marka değerini miras alsın. `dynamicLightColorScheme` kaynakta
  hiç geçmiyor — yanlışlıkla geri açılacak bir şey yok.
- **`label` stilinin UPPERCASE'i `KlinaraType.labelText()` ile**, `Locale.ROOT` ile
  değil: `"i"` → `"İ"` olmalı, `"I"` değil. Galeride "TÜRETİLMİŞ OPAKLIKLAR" ile
  doğrulandı.
- **iOS'un toplamsal `lineSpacing`'i Compose'un toplam `lineHeight`'ına çevrildi**
  (17sp + 3 → 20sp) ve her stile `includeFontPadding = false` verildi — Compose'un
  eski varsayılanı SwiftUI'da olmayan ascender dolgusu ekliyor.
- **Varyant kaynak kümeleri deseni kuruldu:** `RootContent` hem `src/debug` hem
  `src/release` altında var, birbirini dışlıyorlar. Token galerisi ve (A1.1'de)
  geliştirici senaryo menüsü release APK'ye hiç girmiyor.

---

## A0.3 — Tasarım sistemi: bileşenler ✅

**Durum:** `./gradlew check` yeşil, 13 birim testi. Bileşen galerisi emülatörde açık ve
koyu temada doğru; telefon maskesi, parola gösterme, OTP kutuları gerçek girdiyle
sürüldü. TalkBack etiketleri doğrulandı ("Telefon numarası, on hane", "Doğrulama kodu,
6 hane", "Parolayı göster").

### 20 değil 9 bileşen — gerekçe

A1.1–A1.5'in çağırdığı tam küme yazıldı: `KlinaraButton`, `KlinaraTextField`,
`PhoneNumberField`, `OtpCodeField`, `ErrorBanner` + `AuthLoadingOverlay`,
`AuthScaffold`, `KlinaraLogo`, `KlinaraCard` (Card/Divider/Row/NavigationRow),
`KlinaraBadge`.

Bir Compose bileşeninin şekli (slot lambda mı değer parametresi mi, state hoisted mı
içeride mi) ancak gerçek bir çağıran karşısında doğru kararlaştırılır. iOS `init`
imzaları bileşenin hangi **veriye** ihtiyacı olduğunu söyler, hangi **Compose
API'sine** olduğunu değil. Ertelenenler ve yerleri: `KlinaraScreen`+`EmptyStateView`
→ A2.1, `CalendarGridPrimitives` → A3.1, `SegmentedPicker` → A3.2,
`SearchablePicker` → A3.4, `ChipGrid`/`FormScaffold` → A4.2, `TextEditor` → A4.3,
`FormFields`+`FlowLayout` → A5.1, `ColorSwatchPicker` → A7.1, `Chart`/`ReportPeriodBar`
→ A9.

### Yakalanan gerçek hata: telefon alanı hiçbir tuşu kabul etmiyordu

`toE164` on haneden azı için bilerek `""` döndürüyor (yarım numara sunucuya gitmesin
diye). Alan `extractDigits(e164)` ile türetilince ilk dokuz tuş vuruşu geri okunduğunda
kayboluyordu — kullanıcı yazıyor, ekranda hiçbir şey olmuyor.

Alan artık hane dizisini **kendi durumu** olarak tutuyor ve E.164'ü dışarı türetiyor;
dışarıdan tam bir numara gelirse (ön doldurma) benimsiyor, boş `e164` ise "henüz yarım"
demek olduğu için kullanıcının yazdığını ezmiyor. `PhoneNumberTest` bu hatanın
regresyon testini içeriyor (her ara adım kendini geri okuyabilmeli).

### Kararlar

- **Ripple kapalı** (`klinaraClickable`): geri bildirim tüm kontrole uygulanan bir
  sönme (`PRESSED_ALPHA = 0.72`) — iOS ile aynı his, ve dalga efekti "calm,
  authoritative" ile çelişiyor. Aynı modifier `minimumInteractiveComponentSize()` ile
  her tıklanabilir öğeye 48dp taban veriyor; §7.3'ü tek tek hatırlamaya bırakmıyor.
- **OTP: altı kutu, tek gizli alan.** Kutu başına ayrı `TextField` SMS otomatik
  doldurmayı ve yapıştırmayı bozar, ekran okuyucu da altı ayrı alan duyurur.
- **`ErrorBanner` `liveRegion = Polite`**: görme engelli kullanıcı ekranın ortasında
  beliren bir metni yoksa hiç fark etmez.
- **Hata satırı her zaman yer kaplar** (`FieldErrorText`): hata belirdiğinde altındaki
  buton yer değiştirmez ve kullanıcı yanlış yere basmaz.
- **`AuthScaffold` aksiyon alanı `imePadding` ile yukarı gelir** — birincil buton
  klavyenin altında kaybolmaz.
- **Logo iOS varlığının kendisi.** Kendi vektörümü çizmiştim; iOS'ta gerçek bir
  `LogoMark.png` (1x/2x/3x) olduğu görülünce parite gereği o kullanıldı. Eksik yoğunluk
  kovaları (hdpi, xxxhdpi) monorepo'daki `sharp` ile lanczos3 ile üretildi — lint
  `IconMissingDensityFolder` ile haklı olarak uyarmıştı.

### Yeni bağımlılık (§7.7)

`androidx.compose.material:material-icons-**core**` — dört ikon için (geri, ileri,
uyarı, kilit). `-extended` ~1000 ikon taşıyor; ihtiyaç core ile karşılanıyor.

### detekt bulguları — biri düzeltildi, biri kapatıldı

- `CyclomaticComplexMethod` (19/15) `KlinaraButton`'da: eşiği yükseltmek yerine renk
  çözümü `buttonPalette()` fonksiyonuna çıkarıldı. Gerçek bir okunabilirlik kazancı.
- `MatchingDeclarationName` kapatıldı: bir `@Composable` ile kendi seçenek enum'u
  (`KlinaraButton` + `KlinaraButtonKind`) aynı dosyada durmalı; kural Java'nın "bir
  dosya bir sınıf" varsayımını taşıyor.

---

## A0.4 — Ağ katmanı ✅

**Durum:** `./gradlew check` yeşil — **54 birim testi** (20 MockWebServer sözleşme testi,
7 tarih çözümleme, 8 TokenStore, 11 telefon, 2 iskele, 6 diğer) + **5 instrumented test**
gerçek `AndroidKeyStore` ile emülatörde. R8 release derlemesi geçiyor.

### Retrofit KALDIRILDI (§3'ten sapma)

§3 "OkHttp 5 + Retrofit 3" diyor ama §5.4 tek bir `ApiClient` boğazı tarif ediyor ve
ikisi uyumsuz. Retrofit'in tüm değeri annotation'dan tipli istemci üretmek; burada her
servis elle yazılmış `Live*Service` ve her metot bir `ApiRequest` kuruyor:

- `Idempotency-Key`, `If-Match`, `X-Branch-Id` `@Header` parametresine dönüşürdü — yani
  §5.4'ün önlemek için var olduğu "bir uçta unutmak" hatasının ta kendisi.
- `sendOptional` (boş 200 → null) ve `bearerOverride` özel `CallAdapter`/converter
  işi isterdi; elle yazılan istemcide üçer satır.
- İki bağımlılık ve "neden suspend fonksiyonum `Response<T>` döndürüyor" kafa karışıklığı eksildi.

### İki farklı koruma mekanizması — riske göre eşleme

**İmzalı yükleme ve `/auth/refresh` → hiç interceptor'ı olmayan ayrı istemci.**
Buradaki hata modu oturum bearer'ının üçüncü parti nesne depolamasına sızması (güvenlik
olayı) ya da yenilemenin kendi `Authenticator`'ına yeniden girmesi. Interceptor'ı hiç
kurulmamış bir istemcide ikisi de **yapısal olarak imkânsız**; `bareHttp`'yi kurucu
üzerinden alan tek sınıf `SignedUploader`. `newBuilder()` ile türetildiği için bağlantı
havuzu, dispatcher ve DNS paylaşılıyor — ek maliyet yok.

**Kendi API'miz → OkHttp tag'i.** `bearerOverride` ve `requiresAuth=false` hâlâ bizim
sunucumuza gidiyor (aynı taban URL, `X-Request-Id`, problem+json). Tag burada güvenli
çünkü bu istekleri kuran **tek bir yer var**: `ApiClient.execute()`.

Testler bunu VARLIK değil **YOKLUK** üzerinden doğruluyor: imzalı yüklemede
`Authorization`/`X-Branch-Id`/`X-Request-Id`/`Accept` yok, `bearerOverride`'da
`X-Branch-Id` yok, `/auth/refresh`'te `Authorization` yok. Sızıntılar tam olarak orada oluyor.

### Tek uçuşlu yenileme — iOS'a göre iki iyileştirme

Test: **üç eş zamanlı 401 → tam olarak bir `POST /auth/refresh`.**

1. **Bayat token karşılaştırması.** iOS paylaşılan task'ı `defer` ile temizlediği için,
   başarılı bir yenilemeden mikrosaniyeler sonra gelen bir 401 bekleyecek task bulamaz
   ve İKİNCİ kez rotate eder — tam da sunucunun reuse-detection'ıyla tüm oturum ailesini
   iptal ettirecek olan durum. Çağıran artık kendi bayat bearer'ını depodakiyle
   karşılaştırıyor. **iOS `APIClient.swift`'e geri taşınmalı.**
2. **Uygulama ömrüne bağlı kapsam.** Yenileme ilk gelen çağıranın kapsamında koşsaydı,
   o çağıranın iptali (ekran kapandı) herkesin yenilemesini iptal ederdi.

### Yakalanan hata: gövdesiz POST derlenmiyor

OkHttp POST/PUT/PATCH için gövde zorunlu tutuyor, ama `POST /auth/logout` ve
`POST /auth/2fa/setup` gövdesiz uçlar. `HttpMethod.requiresBody` eklendi; boş gövde
**null medya tipiyle** gönderiliyor, böylece `Content-Type` başlığı oluşmuyor ve iOS'un
davranışı (Content-Type yalnız gerçekten gövde varken) korunuyor. Dört test yakaladı.

### İptal tuzağı

OkHttp iptal edilmiş çağrıyı `IOException("Canceled")` olarak yüzeye çıkarıyor. Her
`IOException`'ı `ApiError.Network`'e eşlemek her gezinmeyi sahte bir "bağlantı hatası"
afişine çevirirdi. `execute()` önce `currentCoroutineContext().ensureActive()` çağırıyor.
Testi var.

### Tarih: iOS'un iki-formatter sorunu Android'de YOK

`ISO_OFFSET_DATE_TIME` 0–9 kesir hanesini zaten kabul ediyor. **Bilerek korunan yarısı**
çıplak tarihin bir `Instant`'a düşmemesi — offset zorunlu olduğu için bedava geliyor.
`Instant.parse` KULLANILMADI: offset davranışı Java sürümleri arasında değişti ve API
26'da desugar kütüphanesinin anlık görüntüsüne kalınırdı.

*Desugaring notu:* `ZoneId.of("Europe/Istanbul")` cihazın değil `desugar_jdk_libs`'in
gömülü tzdb'sini kullanır. Determinizm kazancı ama bir tz kural değişikliği OS
güncellemesiyle değil, bağımlılık yükseltmesi + uygulama sürümüyle gelir.

### TokenStore

AES-256/GCM, 128-bit etiket, **12 baytlık sağlayıcı üretimi IV** başa ekleniyor.
`setRandomizedEncryptionRequired(true)` kendi IV'nizi vermeyi aktif olarak yasaklıyor —
GCM'de IV tekrarı anahtarı kırar, API doğru şeyi zorluyor. Instrumented test her
mühürlemede IV'nin farklı olduğunu ve değiştirilmiş bir blob'un reddedildiğini doğruluyor.

**StrongBox kullanılmadı**: API 28+ olduğu için minSdk 26'yı gerekçelendiremez ve tehdit
modelimize karşı TEE destekli AES zaten yeterli; karşılığında OEM'lerde
`StrongBoxUnavailableException` getirirdi.

**Kural: çözememek çıkış yapmak demektir, asla çökmek değil.** `GeneralSecurityException`,
`SerializationException` ve `IllegalArgumentException` → anahtarı sil, blob'u sil, `null`
dön. Yayılsalardı Keystore'u bozulmuş bir kullanıcı uygulamayı bir daha hiç açamazdı.

**`android.util.Base64` yerine `java.util.Base64`** (API 26+, tam tabanımız): Base64'ün
GERÇEKTEN çalışması testin anlamı için şart; mühürle/aç gidiş-dönüşü aksi hâlde
doğrulanamazdı. `android.util.Log` için `unitTests.isReturnDefaultValues = true` —
tek satırlık `Log.w` için Robolectric getirmek orantısız olurdu.

**Test bölünmesi dürüst:** `TokenStore`'un MANTIĞI JVM'de `InMemorySessionCipher` ile,
gerçek `KeystoreSessionCipher` cihazda instrumented testle. Robolectric'in Keystore'u
kapsadığını varsaymak, kendi token'ını okuyamayan bir uygulama yayınlamanın yoludur.

### `onSessionExpired` callback değil AKIŞ

`MutableSharedFlow(replay=0, extraBufferCapacity=1, DROP_OLDEST)`. Activity/ViewModel'in
tuttuğu bir callback onları sızdırır ve daha kötüsü Activity yeniden yaratılırken
**null**'dur — o pencereye düşen sona erme sessizce yutulur ve kullanıcı sonsuza dek 401
üreten bir ekranda oturur. `extraBufferCapacity` olayın sonraki toplayıcıyı beklemesini,
`DROP_OLDEST` bir 401 fırtınasının tek bir çıkışa çökmesini sağlar.

### Sözleşme üretimi (A0.5'ten öne alındı)

`tools/gen-client-contracts.mjs` `packages/shared`'ın DERLENMİŞ çıktısını okuyor (rol
demetleri `spread`/`filter` ile hesaplanıyor; TS'i metin olarak ayrıştırmak kırılgan olurdu)
ve `ApiErrorCode.kt` + `Permissions.kt` üretiyor. `pnpm gen:contracts` / `--check`.
**Gradle bunu asla çağırmaz** — Android derlemesi node/pnpm'e bağımlı değil.

**İlk bulgusu:** sözleşmede **61 hata kodu** var, iOS'ta elle kopyalanan liste **47**.
Yani 14 kod sessizce sapmış (`CONTRAINDICATION_BLOCK`, `CONSENT_REQUIRED`, `HOST_TAKEN`
ve tüm online randevu ailesi). iOS'un da bu üreticiyi kullanması ayrı bir iş olarak
açılmalı.

### detekt bulguları — dördü düzeltildi, biri gerekçeyle gevşetildi

- `CyclomaticComplexMethod` (21/15) `problemMessage`: `when` zinciri **tabloya** çevrildi.
  Bu bir arama tablosuydu, denetim akışı değil.
- `SwallowedException` ×4: haklıydı — taşıma istisnası tamamen kayboluyordu.
  `ApiError` artık `cause` taşıyor; zaman aşımı mı DNS mi bağlantı sıfırlaması mı,
  üretimde teşhis için gerekli. Kullanıcı yine tek bir cümle görüyor.
- `MagicNumber` ×2: `appendInstant(3)` ve IPv4 etiket sayısı adlandırıldı.
- `ApiEnvironment.isPasskeyConfigured`: yazdığım uydurma IP sezgisi okunaksızdı,
  gerçek bir kontrolle değiştirildi (bir IP asla geçerli RP ID değildir).
- `ReturnCount` eşiği 5'e çıkarıldı: ağ katmanında "yoksa çık" zinciri doğal olarak
  4-5 return ve guard clause'lar iç içe yuvalamadan okunaklı.

### Doğrulanan: elle R8 kuralı GEREKMİYOR

`kotlinx-serialization-core` kendi kurallarını `META-INF/com.android.tools/proguard/`
altında taşıyor ve R8 onları tüketiyor. "Her ihtimale karşı" keep kuralı eklemek
gereksiz borç olurdu. Küçültülmüş APK ile tam regresyon A10'un işi.

### §7.9 sızıntı denetimi

`app/src/main` içinde tek log çağrısı grubu `TokenStore`'un üç `Log.w`'si ve hepsi
yalnız **istisna sınıf adını** basıyor; token, telefon ya da isim yok. `println` yok.
detekt `Log.d`/`Log.v`/`println` çağrılarını zaten yasaklıyor.

---

## A0.5 — Servisler, mock grafiği, biçimlendirme ✅

**Durum:** `./gradlew check` yeşil — **95 birim testi** + 5 instrumented. Debug APK
açılıyor, `ServiceContainer.live()` Keystore ve DataStore'a dokunuyor, çökme yok.
Fixture'lar debug APK'de var, **release APK'de yok** (doğrulandı).

### On altı arayüz değil, bir tane

Yalnız `AuthService` + `LiveAuthService` + `MockAuthService`. On beş boş arayüz
okunmamış uçlar için imza tahmini kodlar, sonra her batch'te "refactor" edilir —
ilerleme gibi görünen çalkantı; ayrıca `./gradlew check`'e sıfır testli on beş dosya
verir ve §7.2'yi boşa çıkarır. `ServiceContainer` diğer on beşi faz numaralarıyla
**yorum olarak** taşıyor: büyüme yolu görünür ama sahte değil.

A0.5'in kanıtlaması gereken ŞEKİLDİ ve bir servis dördünü de kanıtlıyor: live/mock
çifti, Application ömrü, hem test classpath'inde hem debug APK'de çalışan fixture
okuyucu, üretim çözümleyicisinden geçen mock yanıtlar.

### Fixture'lar: `klinara-fixtures/` (repo kökü)

**Bu bir çıkarma işiydi, kopyalama değil.** iOS'ta hiç `.json` yok; auth fixture'ları
`MockAuthService.swift`'in **üretim hedefindeki** sonunda Swift string literal'i olarak
duruyordu. 15 dosya çıkarıldı.

**Java kaynağı, `assets/` değil.** `assets/` bir `AssetManager` ister, o bir `Context`
ister, o `Context` `MockAuthService`'e ve oradan `ServiceContainer.mock()`'a sızar;
sonra birim testleri sırf bir JSON string'i okumak için Robolectric ister. Java
kaynakları hem APK'ye hem test classpath'ine girer, tek okuyucu ikisinde de çalışır.
`srcDir` yalnız `test` ve `debug`'a eklendi.

### İzinler artık ÜRETİLİYOR — iOS'un saptığı yer kapandı

`MockAuthService` `/me` yanıtının `permissions` alanını fixture'dan DEĞİL, üretilmiş
`RolePermissions`'tan alıyor. iOS'un aynı listeyi elle tuttuğunu ve Faz 6 finans
izinlerinin hiç eklenmediğini kendi kod yorumu itiraf ediyor — mock modda kasa, prim ve
cari hesap ekranlarına ulaşılamıyordu; testin yakalayamadığı, yalnız elle gezerken
görülen bir kayıp. `MockAuthServiceTest` artık `finance.payment:read`,
`finance.commission:read` ve `finance.price:override`'ın manager demetinde bulunduğunu
açıkça assert ediyor.

Üretici bu batch'te `RolePermissions` üretecek şekilde genişletildi (rol demetleri
`spread`/`filter` ile hesaplandığı için TS'i metin olarak ayrıştırmak değil, **derlenmiş
paketi import etmek** doğru yol).

### Money: `NumberFormat.getCurrencyInstance` KULLANILMADI

JVM (JDK CLDR) ile Android (ICU) aynı yerel için farklı çıktı verir — sembol konumu,
NBSP vs normal boşluk. Birim testleri yeşil olur, **cihazda çıktı yanlış** olurdu.
Ayırıcılar ve sembol açıkça kuruluyor; bir test cihaz yerelini `US` ve `GERMANY` yapıp
çıktının değişmediğini doğruluyor.

### Testlerimin iki kez yanıldığı yerler

1. **Bankacı yuvarlaması testi:** `"0.125"` yazmıştım ama üç basamak kuralı gereği nokta
   BİNLİK ayırıcı sayılıyor (iOS'ta da öyle) — 125 lira oluyor. Kod doğruydu, iddia
   yanlış yere bakıyordu. Virgüllü yazımla düzeltildi ve nokta sezgisi için ayrı bir
   test eklendi.
2. **DST testi:** 2026'da AB yaz saati **29 Mart**'ta başlıyor, yani kısa gün 29→30, 28→29
   değil. Yine kod doğru, tarih yanlıştı. Test artık o gecenin gerçekten 23 saat
   olduğunu assert ediyor — `plusSeconds(86400)` kullanılsaydı kırılırdı.

### Yakalanan gizli çökme: iki DataStore

`ServiceContainer.live()` ve `.mock()` ikisi de kendi `PreferenceDataStoreFactory`
örneğini kuruyordu. DataStore **aynı dosya için ikinci bir örneğe izin vermez ve çöker**;
geliştirici menüsünden canlı ↔ mock geçişi (A1.1) uygulamayı düşürürdü. Ayrıca
`KlinaraApplication`'da bir "yer tutucu" container kurmuştum — o da `onCreate` anında
aynı çökmeyi verirdi. Depo artık Application ömründe, container'lar arasında paylaşılıyor.

### detekt: on bir bulgu, dokuzu kod düzeltmesiyle

Kendi kısayollarımı temizlettirdi: `BranchClock.MonthUnit` enum'u aşırı yükleme
ayrıştırmak için uydurulmuş bir hileydi → `addingMonths`. `ServiceContainer`'daki
`_mockDataScenario` alt çizgisi → düz alan. `ServiceContainer.mock()`'un kullanmadığı
`scope` parametresi → kaldırıldı. `Slug.make` dört seviye iç içe bloğa çıkıyordu →
karakter durum makinesi ayrı bir fonksiyona alındı. Sabitler adlandırıldı.

İkisi gerekçeyle gevşetildi: `TooManyFunctions.thresholdInInterfaces` (servis arayüzü
sunucu uç kümesinin aynasıdır; `AuthService` 15 uç taşıyor ve bölmek sözleşmeyi ikiye
böler) ve daha önce `ReturnCount`.

---

## A1.1 — Akış iskeleti ve tanımlayıcı ✅
## A1.2 — Parola, TOTP, yedek kod ✅
## A1.3 — Kiracı ve şube seçimi ✅
## A1.4 — Parola kurtarma ve telefon doğrulama ✅

**Durum:** `./gradlew check` yeşil — **126 birim testi** + 5 instrumented. Uçtan uca
cihazda sürüldü: `parola → TOTP → oturum`, 35 izin üretilmiş demetten geldi, şube
kapsamı yazıldı. R8 ile küçültülmüş release APK (2.0 MB) da açılıyor.

### A1.5 ertelendi — ve gerekçesi dokümanda eksikti

`PasskeyService` arayüzü + `PasskeyOutcome` + `UnavailablePasskeyService` **A1.1'de**
kondu; `PasskeyEnrollOfferScreen` de yazıldı. Dal derleniyor, test ediliyor
(`passkeyOfferSkippedWhenUnavailable`, `passkeyOfferShownWhenAvailable`) ve uykuda
duruyor. A1.5 saf bir değiştirme olacak; yönlendirme kodu hiç değişmeyecek.

**Asıl erteleme sebebi R1'de yazılmamış:** bir WebAuthn RP ID **asla bir IP adresi
olamaz**. `10.0.2.2` ya da `localhost` üzerinden passkey geliştirilemez — assetlinks
olsun olmasın. Gerçek bir https konak şart. `ApiEnvironment.isPasskeyConfigured` bunu
açıkça kontrol ediyor.

### Yakalanan gerçek hata: süreç ölümünden sonra ÇÖKME

Planın `adb shell am kill` doğrulaması tam da bunu yakalamak içindi ve yakaladı:
`start()` oturum geri yüklemeyi `perform {}` sarmalayıcısının **dışında** çağırıyordu,
dolayısıyla sunucuya ulaşılamadığında `ApiError.Network` yakalanmadan yayılıp uygulamayı
düşürüyordu. Diskte geçerli bir oturumu olan her kullanıcı, sunucu kapalıyken
uygulamayı açamıyordu.

Düzeltme yalnız `try/catch` değil: geçici bir ağ hatası yüzünden **geçerli bir oturumu
atmak** da yanlış olurdu (kullanıcı sebepsiz yeniden giriş yapardı). Artık `Launch`
adımında kalınıyor, `LaunchScreen` hatayı ve "Tekrar dene"yi gösteriyor, token diskte
duruyor. Oturumu gerçekten geçersiz kılan token hataları `capture` tarafından zaten
çıkışa çevriliyor. İki regresyon testi eklendi.

**Not:** `am kill` ÖN PLANDAKİ süreci öldürmez. İlk denemede uygulama hâlâ yaşıyordu ve
test yanlışlıkla yeşil görünüyordu; önce `KEYCODE_HOME`, sonra `am kill` gerekiyor.
A10'un yapılandırma değişimi denetiminde bu not önemli.

### Yakalanan ikinci yarış: `start()` kullanıcının adımını eziyordu

Oturumu olmayan kullanıcı için `start()` 450 ms bekleyip `Identifier`'a geçiyor. O
pencerede kullanıcı (ya da otomatik doldurma) ilerlemişse geçiş, bulunduğu adımı
eziyordu. Artık yalnız hâlâ `Launch`'taysa geçiş yapılıyor. Testler ortaya çıkardı.

### Mock'ta düzeltilen eksik

`NetworkError` senaryosu yalnız `login()`'i kesiyordu. Gerçek bir ağ kesintisi **her**
çağrıyı keser — ve oturum geri yükleme yolunun dayanıklılığını ancak `me()` de
düşerse test edebiliriz. `transportFailure()` artık `me`, `branches` ve `verifyMfa`
için de uygulanıyor. Girişe özgü senaryolar (`WrongPassword`, `AccountLocked`,
`RateLimited`) oturum sonrası çağrıları etkilemiyor — doğru model bu.

### `SavedStateHandle` yok — gerekçe kodda yazılı

Çekingenlik değil doğruluk: `step`'i kaydetmek kullanıcıyı, challenge token'ı yalnız
bellekte olan bir TOTP ekranına geri koyardı — **başarılı olması imkânsız** bir ekran.
Süreç ölümünde `TokenStore` (disk, şifreli) tek otorite; yarım kalmış bir MFA
challenge'ını kaybetmek güvenlik açısından da doğru cevap. Cihazda doğrulandı.

### iOS'ta canlı olan hatanın düzeltmesi

`BranchSelect` ve `PhoneVerification` adımlarında token ZATEN diskte. iOS'ta `goBack()`
yalnız `step` değiştiriyor; Android'de bu, sonraki soğuk açılışta kullanıcıyı çıkışı
olmayan telefon doğrulama ekranına kilitlerdi. Geri artık bu iki adımda `logout()`
çağırıyor ve iki test bunu sabitliyor (`backFromBranchSelectClearsTokens`,
`backFromPhoneVerificationClearsTokens`). **iOS'a bildirilmeli.**

### Kasıtlı sapmalar (§7.8)

1. **`AuthStep` payload taşıyan sealed interface**, iOS'un düz enum + kardeş
   property'leri değil. "Kod olmadan yedek kod ekranı çizilemez" derleme zamanı gerçeği
   olur ve `step` ile verisinin desenkronize olma hata sınıfı ortadan kalkar.
2. **`TotpSetupScreen`'de QR YOK.** §6 A1.2 "QR + gizli anahtar" diyor ama iOS
   `TOTPSetupView` yalnız gizli anahtarı gösteriyor; iOS izlendi (yeni bağımlılık yok).
   Üstüne Android'de gerçekten deyimsel olan **"Uygulamada aç"** (`otpauth://` intent)
   eklendi; kurulu kimlik doğrulayıcı yoksa sessizce yutuluyor — bu bir hata değil.
3. **`Launch` ekranından da geliştirici menüsü açılabiliyor.** Sunucu ulaşılamazken bu
   ekranda kalınıyor ve başka giriş noktası olmazsa geliştirici mock senaryolarına
   geçemez — planın `WrongPassword` için uyardığı "kapana kısılma"nın aynısı.
4. **`sendVoid`** ayrı bir ad: JVM'de dönüş tipine göre aşırı yükleme yok ve
   `send<Unit>` 204'te çözümleme deneyip patlardı.

### `onSessionExpired` akışı çalışıyor

`sessionExpiryReturnsToIdentifier` testi: sunucu oturumu iptal edince akış girişe
dönüyor ve token siliniyor. Callback yerine `SharedFlow` seçilmesinin gerekçesi A0.4
notunda.

### Doğrulanan release hijyeni

R8 ile küçültülmüş APK'de **fixture yok, `MockAuthService` yok, `TokenGalleryScreen` /
`ComponentGalleryScreen` / `DeveloperScenarioScreen` yok**. `.debug` soneki sayesinde
iki varyant emülatörde yan yana kurulu.

### Kalan: A1.5

Ön koşullar P2–P5 **ve** gerçek bir https staging konağı hazır olduğunda
`CredentialManagerPasskeyService` yazılıp `UnavailablePasskeyService` yerine geçecek.
§8'deki M1 kilometre taşı tanımı **"passkey ile giriş" → "parola ile giriş"** olarak
güncellenmeli.
