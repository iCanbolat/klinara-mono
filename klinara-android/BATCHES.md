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

---

## A2.1 — Uygulama kabuğu ✅

**Durum:** `./gradlew check` yeşil — **144 birim testi** (126 → +18) + 5 instrumented.
R8 ile küçültülmüş release APK 2.27 MB; fixture, `MockAuthService`, galeriler ve
geliştirici menüsü **yok** (dex taranarak doğrulandı).

Emülatörde (API 37, Pixel 10 Pro) uçtan uca sürüldü: `Çok şubeli` senaryosu → parola →
şube seçimi → dört sekmeli kabuk; şube menüsünden Bodrum'a geçiş üst çubuğa **ve**
profildeki Oturum kartına aynı anda yansıdı. Koyu tema, `fontScale 2.0` ve yatay
çevrim kontrol edildi; `uiautomator` ağacında şube menüsü "Şube: Nişantaşı" olarak,
boş durum **tek düğüm** olarak, seçili sekme `selected="true"` ile duyuruluyor.

### `accountant` elle sürülmedi, birim testine taşındı — ve gerekçesi

Plan başta "emülatörde `accountant` rolüyle gir" diyordu. `MockScenario.roleKey` yalnız
`manager`/`practitioner` veriyor, yani bu sürülemezdi. İki yol vardı: geliştirici
menüsüne üçüncü bir eksen (senaryo × veri × **rol**) eklemek, ya da ölçütü teste taşımak.

İkincisi seçildi: **sekme görünürlüğü saf bir fonksiyondur** (izin kümesi → sekme
kümesi). `ShellTabTest` altı rolü de sürüyor ve `MANAGEMENT_PERMISSIONS`'tan finans
izinlerini çıkarınca **kırıldığı doğrulandı** — yani iOS'ta bir kez yaşanan "muhasebe
kendi ekranlarına ulaşamıyor" hatasının gerçek regresyon koruması var. Menüye rol ekseni
eklemek, tek bir `assert`in kapattığı bir şey için app scope'u büyütmek olurdu.

`MockScenario`'ya girdi **eklenmedi**.

### Kararlar

- **Sekme başına ayrı `NavHostController`.** A2'de her grafiğin tek hedefi var; şimdi
  kurulmasının sebebi A3–A9'un sekme içi ekran eklerken kabuğu yeniden yazmaması.
  Dört controller açıkça `remember`lanıyor (`entries.associateWith { rememberNavController() }`
  yerine): inline lambda içinde composable çağırmak çalışır ama okuyucuya çalışıp
  çalışmadığını düşündürür.
- **Material3 `NavigationBar` taşıyıcı olarak kullanıldı**, kendi `Row`'umuz değil:
  seçili sekmenin ekran okuyucuya `Tab` rolü ve "seçili" durumuyla duyurulması elle
  kurulacak bir şeydi. Renkler token'lardan; ripple burada M3'ün işi (§5.6 "ripple,
  tipografi ölçeği, erişilebilirlik varsayılanları" zaten taşıyıcıdan geliyor). A0.3'ün
  ripple kapatma kararı **kendi** kontrollerimiz içindi.
- **`KlinaraScreen` M3 `TopAppBar` KULLANMIYOR.** Kendi tipografimizi, yüksekliğimizi ve
  ripple'sız geri düğmesini enjekte etmek için onun renk/scroll davranışının çoğunu
  ezmek gerekiyordu; geriye taşıyıcı olarak hiçbir şey kalmıyordu. Düz bir `Row` dürüst.
- **Sekme etiketi `maxLines = 1` + ellipsis.** `fontScale 2.0`'da dört sekme yan yana
  sığmıyor; kırpmak sarmaktan iyi, çünkü ikon ve seçili durum anlamı zaten taşıyor.
- **Bugün ve Profil her zaman çizilir.** Varsayılan seçili sekmenin bazı rollerde
  kaybolması, bilgi mimarisini role göre değiştirmek olurdu (iOS gerekçesinin aynısı).
- **`Scaffold(containerColor = Transparent)`** — zemin `KlinaraTheme`'in tam kanamalı
  `Surface`'inden geliyor. Scaffold kendi zeminini boyasaydı A0.2'de düzeltilen "sistem
  çubuklarının arkası beyaz" hatası geri gelirdi.
- **`AppSession` immutable kaldı.** `SessionViewModel` onu `copy()` ile yeniliyor;
  ikinci bir mutable model sınıfı eklenmedi. `switchBranch` sırası kritik ve testle
  sabitlendi: **önce `TokenStore`**, sonra state — `X-Branch-Id`'nin kaynağı depo, depoya
  yazılmadan yapılan istek hâlâ eski şubeye gider.
- **`SavedStateHandle` yok** (A1.1 gerekçesinin aynısı): süreç ölümünde `TokenStore` tek
  otorite. Profili ve izinleri kaydetmek bayat bir izin kümesiyle uyanmak demekti.

### Yeni bağımlılık (§7.7)

| Bağımlılık | Gerekçe |
|---|---|
| `androidx.navigation:navigation-compose 2.9.8` | §3 zaten öngörüyordu, katalogda yoktu. Sekme başına geri yığını ve tip güvenli `@Serializable` route. Gradle önbelleğinde mevcut, çevrimdışı çözülüyor; `compileSdk 37` istemiyor (A0.1'de `core-ktx`/`lifecycle`'ı düşürten kapı burada kapanmadı). |

### detekt bulgusu

`SpreadOperator` — `canAny(*MANAGEMENT_PERMISSIONS)` her çağrıda diziyi kopyalıyordu ve
bu bir sekme çiziminde her recomposition demek. `AppSession.canAny`'ye `Collection`
aşırı yüklemesi eklendi, sabit `setOf` oldu. Gerçek bir düzeltme, susturma değil.

---

## A2.2 — Profil ve oturum ✅

### `/me` TOTP durumunu taşımıyor — doğrulandı

Doküman A2.2'de "TOTP durumu" diyordu ve bunun `/me`'den geleceği varsayılmıştı.
`MeResponseDto` (`apps/api/src/modules/identity/dto/user.dto.ts`) böyle bir alan
taşımıyor. Ama `GET auth/2fa` **zaten var** (`totp.controller.ts`) ve
`{ enabled, backupCodesRemaining }` dönüyor — hiçbir istemci çağırmıyordu.
**Yeni uç eklenmedi**, var olan uç ilk kez kullanıldı.

### Passkey yönetimi A1.5'i beklemiyor

`GET auth/passkeys` ve `DELETE auth/passkeys/:id` Credential Manager gerektirmez; düz
API çağrılarıdır. iOS'ta ya da web'de kaydedilmiş anahtarlar Android'de görünüyor ve
silinebiliyor. **Kayıt** düğmesi A1.5'e kaldı — onu yazabilmek için gerçek bir https
konak gerekiyor.

`AuthService` 15 → 18 uç. detekt `thresholdInInterfaces` 25, sınır aşılmadı.

### Son passkey silinemez — 409 bir çökme değil, bir ret

Sunucu parolası olmayan bir hesabın son anahtarını silmesini 409 `CREDENTIAL_REQUIRED`
ile engelliyor (kurtarılamayan tek hata sınıfı). İstemci bunu **iyimser silme
yapmadan** ele alıyor: satır önce kaldırılıp sonra geri konmuyor, çünkü bu kullanıcıya
bir an için gerçekleşmemiş bir şeyi göstermek olurdu. Kod `ApiError` tablosunda yok, bu
yüzden sunucunun kendi `detail` metni gösteriliyor — ve bir test bunun gerçekten
sunucudan geldiğini ("parola" kelimesini arayarak) sabitliyor.

Mock'ta silme **kalıcı**: liste her çağrıda fixture'dan tazelenseydi silinen satır bir
sonraki yenilemede geri gelir ve ekranın davranışı hiç sürülemezdi.

### Kısmi hata: ekranın tamamı boş kalmaz

`totpStatus` ve `passkeys` **paralel** isteniyor ve **bağımsız** başarısız oluyor
(`Loadable<T>` kart başına). Kullanıcının kim olduğu zaten `AppSession`'da; ikinci
dereceden bir bilgi gelmedi diye e-postasını ve şubesini gizlemek yanlış olurdu.
Tek bir `isLoading` bayrağı bunu yapamazdı.

### iOS'a bildirilecek farklar (§7.8)

Üçü de **kasıtlı sapma** ve hiçbiri yeni uç istemiyor:

1. **TOTP durumu satırı** — iOS `ProfileView`'da yok. Kullanıcı 2FA'sının açık olup
   olmadığını hiçbir yerde göremiyor.
2. **Passkey listesi ve silme** — iOS yalnız yerel bir `PasskeyRegistry.hasEnrolledPasskey`
   bayrağı gösteriyor; sunucudaki gerçek listeyi hiç çağırmıyor. Bir kullanıcı kaybettiği
   cihazın anahtarını iOS'tan silemiyor.
3. **Uygulama sürümü** — destek çağrısında ilk sorulan şey; iOS'ta yok.

Ek olarak `MockAuthService.patchedUser` rol adını elle iki dala ayırıyordu
(`practitioner` → "Uygulayıcı", gerisi → "Şube Yöneticisi"); `RoleNames.turkish` zaten
üretilmiş tabloyu taşıyor ve `permissions.ts` ile birlikte değişiyor. Değiştirildi.

### Kapsam dışı bırakılanlar

TOTP kapatma (`DELETE auth/2fa`), yedek kod yenileme (`POST auth/2fa/backup-codes`) ve
passkey yeniden adlandırma (`PATCH auth/passkeys/:id`). Üçü de kod girişi ya da düzenleme
ekranı ister; A2.2'nin işi profil kartıydı, hesap yönetimi ekranı değil.

### Elle gezerken yakalanan iki kusur

1. **Passkey satırında cihaz adı soluk çiziliyordu.** `KlinaraRow` bir etiket/değer
   çiftidir ve etiketi `charcoalMuted` yapar; "iPhone 15 Pro" etiket yerine konunca
   "Son kullanım" ondan baskın görünüyordu. Passkey satırı artık kendi düzenini
   kuruyor. Test bunu yakalayamazdı — hiyerarşi bir `assert` konusu değil.
2. **`ComingSoonScreen` başlığı iki kez okunuyordu** (üst çubukta "Bugün", boş durumda
   yine "Bugün"). Ayrı bir `headline` parametresi eklendi: "Takvim hazırlanıyor".
   Ekran okuyucuda da aynı kelimeyi arka arkaya iki kez duymak gürültüydü.

### Doğrulanamayan: şube seçiminin soğuk açılışta korunması

Uygulama yeniden başlatıldığında container **canlıya** döner (mock bir çalışma zamanı
anahtarı) ve sunucu ayakta olmadığı için akış `Launch` adımında "Bağlantı kurulamadı +
Tekrar dene" ile kalıyor — A1.1'de kasıtla yazılmış davranış. Senaryo değiştirmek de
`forceLogout()` çağırıyor. Dolayısıyla "kapat-aç sonrası Bodrum seçili kalıyor" elle
sürülemedi. Kapsayan testler: `TokenStoreTest` (şifreli diskte gidiş-dönüş, A0.4),
`SessionViewModelTest.switchBranchWritesToTokenStore` (yazma gerçekleşiyor) ve
`routeToBranchOrFinish` (kayıtlı şube varsa seçim ekranı atlanıyor, A1.3). Uçtan uca
doğrulama canlı sunucuyla yapılmalı.

### Yol üstünde bulunan gerçek hata: release kaynak kümesi sürüm kontrolünde DEĞİLDİ

`.gitignore`'daki `release/` deseni derleme çıktısı için yazılmıştı ama Git desenleri
dizin adına her yerde uyar: `app/src/**release**/` de eşleşiyordu. Yani A0.2'de kurulan
varyant kaynak kümesi deseninin release yarısı — `RootContent.kt`, yani release
varyantının **kökü** — hiç commit edilmemişti. Temiz bir klonda `assembleRelease`
kırılırdı ve bu ancak CI kurulduğunda (A11) fark edilirdi.

Bu makinede fark edilmemesinin sebebi dosyanın diskte var olması. `git status` onu hiç
göstermediği için de kimse yokluğunu görmedi.

Desen `app/build/outputs/` ile değiştirildi.

---

## A3.1 — Takvim çekirdeği: servis, store, şerit, ajanda, gün ızgarası ✅

**Durum:** `./gradlew check` yeşil — **181 birim testi** (144 → +37) + 5 instrumented.
R8 ile küçültülmüş release APK 2.30 MB (2.27 → +30 KB). Dex baytları tarandı: üretim
metinleri (`calendar/day`, `calendar/week`, "gelmeyenler") **var**, mock ve fixture
içeriği (`Ayşe Yılmaz`, `Cilt bakımı`, `Çakışma yoğun`, `Fixture bulunamadı`) **yok**.

> **Sınıf adı aramak yanıltıcı.** A2.1'de release dex'inde `MockAuthService` sınıf adı
> aranmıştı; R8 tam modda sınıflar zaten yeniden adlandırılıyor, yani o arama her hâlde
> "yok" derdi. Dize sabitleri obfuscate edilmez — doğru kontrol odur ve bu batch'te öyle
> yapıldı. **A2.1'in doğrulaması geriye dönük olarak zayıftır**, sonucu yanlış değil.

Emülatörde (API 37, Pixel 10 Pro) üç veri senaryosu da sürüldü: `Boş gün` boş durum
metnini gösteriyor, `Yoğun gün` sekiz randevu + iki kapanmış kayıt, `Çakışma yoğun`
09:00'da üç eşit sütun ve 11:00 zincirinde çeyrek genişlik çiziyor. Koyu tema ve
`fontScale 2.0` kontrol edildi (aşağıda iki kusur çıktı).

### Plandan sapmalar

1. **`booking` ve `staff` servisleri planlanandan önce geldi.** Doküman §6 `booking`'i
   A3.4'e, `staff`'ı A7.2'ye koyuyordu. Takvim ikisi olmadan çizilemez: randevular
   `booking`'den, personel adı ve `calendarColor` (filtre çipleri + blok aksanı)
   `staff`'tan geliyor. İkisi de **gerçek metot + gerçek çağıran + kendi mock'u** ile
   geldi, boş arayüz kuralı çiğnenmedi. `BookingService` A3.1'de üç metot; A3.3 yaşam
   döngüsünü, A3.4 oluşturmayı ekleyecek. `ServiceContainer` KDoc'u ve
   `ANDROID_DEVELOPMENT.md` §6 güncellendi.
2. **Ajanda A3.1'e alındı** (dokümanda A3.2'ydi). iOS'un varsayılan görünümü ajanda;
   dokümandaki sırayla yazılsaydı sekme bir batch boyunca modu seçilemeyen, yalnız
   ızgara gösteren bir ekran olarak kalırdı. Mod seçici de tek seferde tam doğdu.
   A3.2'de hafta ızgarası + yoğunluk ısı zemini kaldı.
3. **`Loadable` `features/profile`'dan `services/networking`'e taşındı.** A2.2'de tek
   tüketicisi vardı, artık iki. Üstüne `Loadable.of { }` ve `Loadable.failed(error)`
   eklendi: `ApiError` → `Failed` eşlemesi artık tek yerde. Her çağrı yerinde elle
   `catch` yazmak, bir gün birinin `isRetryable`'ı unutması ve o bölümde "Tekrar dene"
   düğmesinin sessizce kaybolması demekti.

### Yakalanan gerçek hata: `SlotConflict` sunucunun alanlarını okumuyordu

A0.4'te `SlotConflict` `staffProfileId` / `startsAt` / `endsAt` alanlarıyla yazılmış —
`API_DEVELOPMENT.md` §5.4'ün **örneğinden**. Sunucu kodu (`appointments.service.ts:844`)
`resourceType` / `resourceId` / `appointmentId` / **`from`** / **`to`** gönderiyor.
`SlotSuggestion` de tekil `staffProfileId` bekliyordu, sunucu `staffProfileIds` dizisi
gönderiyor.

Dört alan da nullable/varsayılanlı olduğu için **çözümleme çökmüyordu, sessizce boş
kalıyordu**: A3.4'ün çakışma sayfası "dolu olan" satırını hiç çizemez, aday personel
listesi hep boş görünürdü — ve sebebi kodda değil, sözleşmede olduğu için aramak zor
olurdu. Düzeltildi ve `problem-slot-conflict.json` fixture'ı ile çivilendi.

Ders: doküman örneği ile sunucu kodu çeliştiğinde **kod kazanır**. `API_DEVELOPMENT.md`
§5.4'ün örneği de düzeltilmeli (takip işi).

### Yakalanan gerçek hata: iptal edilen randevu ekranda HİÇ görünmüyordu

`CalendarBlockLayout.place` yeniden yapılandırılırken terminal bloklar listenin başına
alındı (önce `partition`, sonra kümeler). Çağıran blokları sırayla üst üste çizdiği için
bu, **çizim sırasını** değiştirdi: 15:00–16:00 aktif blok, 15:30 iptalinin tamamını
örttü. `uiautomator` ağacında iptal satırı **6 px genişlikte** görünüyordu.

Çıktı artık **başlangıç sırasında** dönüyor — "sonra başlayan üstte" kuralı, iOS'un
çizim sırasıyla aynı. `CalendarBlockLayoutTest` bunu sabitliyor.

Bir birim testi bunu yakalayamazdı: yerleşim (x/y/genişlik/yükseklik) **doğruydu**,
yanlış olan listenin sırasıydı ve sıra ancak çizim anında anlam kazanıyor. Test ancak
hatayı gördükten sonra yazılabildi.

### `fontScale 2.0`'da yakalanan iki kırılma

Emülatörde koyu tema + 2x yazı ile sürerken çıktı; ikisi de aynı sınıftan hata (metin
kabı için sabit `dp`):

1. **Tarih şeridi gün rakamını ortadan kesiyordu** — hücrede sabit `height(60.dp)`.
   `Row(height(IntrinsicSize.Max))` + hücrede `fillMaxHeight().heightIn(min = 60.dp)`
   oldu: şerit en uzun hücreye göre büyür, yedi hücre yine eşit kalır. Kesilen bir
   tarih okunamayan bir tarihtir.
2. **Ajanda saat sütunu "09:00"u üç satıra bölüyordu** — sabit `width(48.dp)`.
   `widthIn(min = 48.dp)` + `maxLines = 1` oldu. Saat, bir randevu satırının en çok
   okunan parçası.

### Kararlar

- **Gün ızgarası saat aralığı şube saatlerinden GELMİYOR** (iOS kuralı):
  `min(en erken, 9) ..< max(ceil(en geç), 19)`. Şube saatlerine bağlamak
  `GET branches/:id/hours` çağrısı ve `schedule:read` izni ekler, iOS'tan ayrıştırır;
  ızgaranın çalışma saatlerini izlemesi iki istemcide birlikte alınacak ayrı bir üründür.
- **`AppointmentStatus` için özel serializer + `Unknown` dalı.** Sunucu bu alanı `string`
  yazıyor (`clinic-api.ts` uyarısı). Körlemesine enum'a çevirmek, sunucuya yeni bir durum
  eklendiği gün **tek bir satır yüzünden günün tamamını** çözümleme hatasına düşürürdü.
  `Unknown` terminal SAYILMAZ: bilmediğimiz bir durumu kapanmış saymak, yeni bir
  "beklemede" durumunu sessizce iptal gibi göstermek olurdu.
- **Yükleme anahtarı `mode`'u değil türetilmiş `scope`'u taşıyor** (iOS `LoadKey`
  paritesi): ajanda↔gün geçişi ve aynı hafta içinde gün değişimi **istek atmaz**.
  Testle sabitlendi.
- **`branchGeneration` ilk tüketicisini buldu.** A2.1'de kurulmuş ama hiçbir yere
  bağlanmamıştı; `AppShell` artık sekmelere geçiriyor. Yalnız `activeBranchId` izlense,
  aynı şubeye geri dönüldüğünde bayat gün ekranda kalırdı.
- **Gün başına önbellek YOK** (iOS'ta da yok). Bir randevu takviminde bayat veri,
  olmayan bir boşluğa randevu vermek demektir.
- **`MockBookingSeed` bir tohum, fixture değil.** Takvim "bugünü" göstermek zorunda;
  sabit tarihli bir JSON yarın yanlış olur ve boş bir gün gibi görünür. Fixture'lar
  (`klinara-fixtures/booking/`) **çözümleme sözleşmesini** çiviliyor, tohum ekranı
  sürüyor — ikisi ayrı iştir.
- **Mock saati testte ViewModel'inkine bağlanır.** Bağlanmasaydı testler makinenin
  takvimine göre bir gün geçer bir gün kalırdı; ilk koşuda tam olarak bu oldu.
- **`MockScenario.NetworkError` artık takvimi ve personeli de düşürüyor.** Giriş yolunu
  ağ hatasına ayarlayıp oturum içinde her şeyin çalıştığını görmek, senaryonun yarısını
  yalan söyler hâle getirirdi.

### iOS'a bildirilecek fark (§7.8)

**Tarih şeridi bilmediği gün için "randevu yok" DEMİYOR.** Gün ve ajanda modunda sunucu
yalnız seçili günün yoğunluğunu döndürür; komşu günler hakkında hiçbir şey söylemez.
iOS o günler için ekran okuyucuya "randevu yok" duyuruyor — bilmediği bir şeyi olgu
olarak söylüyor. Android'de bilinmeyen gün sessiz kalır (ne nokta, ne sayı). Yeni uç
istemez, tek fark bir `Map` anahtarının yokluğunun sıfır DEĞİL "bilinmiyor" sayılması.

### Yeni bağımlılık: YOK

`material-icons-extended` **eklenmedi**: çekirdek sette ızgara/hafta ikonu yok ve bir mod
seçici uğruna bağımlılık eklemek gerekçelendirilemez. `KlinaraSegmentedPicker`
**metin-only** — "Ajanda / Gün / Hafta" kendi kendini anlatıyor, ikon orada zaten bilgi
taşımıyordu. Grafik, paging ve tarih seçici kütüphanesi de gerekmedi.

### Tasarım sistemine eklenen üç şey

- `KlinaraSegmentedPicker` — A0.3'te "çağıranı yok" diye ertelenmişti, doğdu.
- `CalendarGridPrimitives` (`CalendarGridMetrics`, `TimeAxisRuler`, `NowIndicator`,
  `AppointmentBlockView`) — ızgara geometrisi. `KlinaraMetrics`'e KONMADI: bunlar marka
  token'ı değil, tek bir ekranın ölçüsü ve 4pt ızgarasına uymayan tek yer.
- `KlinaraScreen(contentPadding =, verticalSpacing =)` — ızgara modları yatay dolguyu
  24 dp'den 16 dp'ye çekiyor; sabit `screenInset` ile saat cetveli + çakışan sütunlar
  okunamaz hâle geliyordu. Varsayılan değişmedi.

### detekt: 106 bulgu, hiçbiri susturulmadı

Hepsi `MockBookingSeed`'de ve hepsi aynı sebepten: konumsal argümanlı bir randevu
tablosu. Çözüm adlandırılmış argümanlar + saatlerin `at("09:30")` biçiminde **üretim
çözümleyicisiyle** (`ClockTime.parse`) okunması oldu. Yan kazanç: tablodaki iki alanı
yer değiştirmek artık derlenmiyor ve saatteki bir yazım hatası ilk testte patlıyor.
`CyclomaticComplexMethod` (tarih şeridi hücresi) iki saf yardımcı fonksiyona bölünerek
kapatıldı.

### Kapsam dışı bırakılanlar

- **Hafta ızgarası ve yoğunluk ısı zemini** → A3.2. Hafta modu bugün tarih şeridi +
  "hazırlanıyor" notu gösteriyor; **sahte bir ızgara çizilmedi** (dolu görünen ama
  tıklanamayan bir hafta, kullanıcıyı denemeye ve güvenini kaybetmeye götürür).
- **Randevu detayı** → A3.3. Bloklara dokunmak bugün bir şey yapmıyor; yarım açılan bir
  sayfa hiç açılmayandan kötüdür.
- **Boş slota dokunup randevu oluşturma, sürükle-bırak taşıma, personel başına sütun** —
  üçü de iOS'ta **yok** ve `calendar/staff` ucu hiçbir istemci tarafından çağrılmıyor.
  Eklemek parite değil, yeni davranış olurdu.

### Bilinen ve KABUL EDİLEN artık

Tam örtüşen bir aktif ve bir terminal blok (15:00–16:00 aktif + 15:30–16:00 iptal) hâlâ
üst üste biniyor: terminal bloklar sütun rezerve etmediği için tam genişlikte çiziliyor
ve iki metin çakışıyor. iOS'ta da böyle ve **kasıtlı** — yerleşim iki istemcide aynı
kalmalı. Görsel baskınlığı azaltmak için terminal bloğa bütünsel `0.6` opaklık eklendi
(iOS'ta var, bende eksikti). Tam çözüm terminal blokları da kümelemeye sokmak olurdu ki
o, iptal edilmiş bir randevunun aktif olanı yarıya sıkıştırması demek.

---

## A3.2 — Hafta ızgarası ve yoğunluk ✅

**Durum:** `./gradlew check` yeşil — **186 birim testi** (181 → +5).
Emülatörde `Yoğun gün` senaryosuyla sürüldü: yedi sütun yatay kaydırma olmadan sığıyor,
gün başlığına dokunmak seçimi taşıyor ve **modu değiştirmiyor**, iptal edilen randevu
soluk ve üstü çizili çiziliyor.

### Yakalanan kusur: ısı zemini randevuları yutuyordu

İlk yazımda hafta sütunlarının saat hücreleri `DensityScale.color` ile **tam doygunlukta**
çizildi. `peak = 1` olan bir haftada — yani her saatte en çok bir randevu, tipik bir
klinik haftası — ekran koyu yeşil bir duvara döndü ve blokların kendisi zeminden
ayırt edilemez oldu.

iOS ısı sütununa `.opacity(0.55)` uyguluyor; taşınırken atlanmıştı. Çift çağrıyla
düzeltmek yerine ölçeğe açık bir varyant eklendi: `DensityScale.backgroundColor`.
Gün modundaki `DensityStrip` tam doygunluğu **korur** — orada ısı bir zemin değil,
bilginin kendisi. İki kullanım iki ayrı fonksiyon; aynı fonksiyonu iki farklı niyetle
çağırmak, bir sonraki değişiklikte birini bozmak demekti.

### Testin yanıldığı yer — ve yine de bir şey bulduğu yer

`DensityScaleTest` "boş saat ile tek randevulu saat aynı görünmemeli" derken
`alpha(0, 8) < alpha(1, 8)` bekliyordu ve **kırıldı** (0.35 > 0.344). Ölçek bozuk
değildi: boş saat `border`, dolu saat `sageDeep` üzerine uygulanıyor — iki farklı renk
ailesi ve alfaları kıyaslanamaz.

Ama test yine de gerçek bir şeyi ortaya çıkardı: `alpha()` **yalnız dolu saatler için**
tanımlıydı ve imzası bunu söylemiyordu. Fonksiyon artık `count`'u 1'e sıkıştırıyor,
KDoc'u sınırını yazıyor ve test renkleri kıyaslıyor.

### Kararlar

- **Saat aralığı yedi günün TAMAMI üzerinden.** Her sütunun kendi aralığı olsaydı aynı
  dikey konum farklı saatler demek olurdu ve hafta okunamazdı.
- **Yatay kaydırma YOK.** Yedi sütun ekrana sığıyor; kaydırma, kullanıcının haftanın
  tamamını asla göremediği bir "hafta görünümü" üretirdi.
- **Hafta kendi dikey kaydırmasını kurar**, `CalendarHomeScreen` bu modda dış kaydırmayı
  kapatır (`scrollable = mode != Week`). Gün başlıkları sabit kalmalı ve iki iç içe
  dikey kaydırma Compose'da zaten çalışmaz.
- **Gün başlığına dokunmak modu DEĞİŞTİRMEZ**, yalnız seçimi taşır. Kullanıcı hafta
  görünümünde kalmak isteyip istemediğine kendisi karar verir (iOS ile aynı).
- **Blok başlığı yalnız yükseklik ≥ 24 dp ise çizilir.** 30 dakikalık bir bloğa
  sıkıştırılan 9sp metin okunmuyor, yalnız gürültü ekliyordu; tam metin
  `contentDescription`'da ve dokunmak detayı açacak (A3.3).
- **"şube geneli" notu filtre açıkken ZORUNLU.** Sunucu yoğunluğu personel filtresine
  göre daraltmıyor; söylememek, kullanıcının seçtiği personelin yoğunluğuna bakıyormuş
  gibi hissetmesine yol açardı ve o yanlış izlenim ekranda hiçbir yerden düzeltilemezdi.
  `CalendarUiState.densityNote` bunu tek yerde üretiyor.
- **Saat etiketi 5 dp yukarı çekiliyor** (metin kutusunun üst boşluğu yüzünden bir
  sonraki saate ait görünüyordu) ve ızgara aynı kadar aşağı itiliyor — ilk etiket
  kırpılmasın diye.

### Emülatör sürüşü betiğe alındı

Elle koordinat tahmini iki kez parolayı iki kez yazdırdı (klavye açıkken düğme kayıyor).
Sürüş artık bir betik: `pm clear` ile temiz başlangıç, düğmeleri **erişilebilirlik
ağacından bulup merkezine** dokunma, her adımda metin bekleme. Betik scratchpad'de,
repoya girmiyor — tek bir emülatör düzenine bağlı ve sürüm kontrolüne girerse bakımı
kimsenin üstlenmediği bir yük olur.

---

## A3.3 — Randevu detayı ve yaşam döngüsü ✅

**Durum:** `./gradlew check` yeşil — **204 birim testi** (186 → +18).
Emülatörde uçtan uca sürüldü: takvim satırına dokunmak detayı açıyor, "Geldi" onay
diyaloğuyla kaydediliyor, **sistem geri tuşu** listeye dönüyor ve liste yeni durumu
gösteriyor; geçmiş ekranı "Onaylandı → Geldi" ile "Oluşturuldu" kayıtlarını sıralıyor.

### Detay bir sheet DEĞİL, bir `NavHost` hedefi

Kural 2: bilgi mimarisi iOS ile aynı, etkileşim deyimi Android'in. `ShellRoutes`'a
`AppointmentDetail(appointmentId)` ve `AppointmentHistory(appointmentId)` eklendi.
Tahmini geri (predictive back), sistem geri tuşu ve geri yığını bedava geldi —
A2.1'de sekme başına `NavHost` kurmanın sebebi tam buydu ve ilk kez karşılığını verdi.

Yan etki, **istenen** bir yan etki: detaydan geri dönünce takvim yeniden yükleniyor
(hedef `NavBackStackEntry`'siyle birlikte yok edilip yeniden kuruluyor). Bir randevu
takviminde geri dönüşte tazelenmek doğru davranış; bayat bir gün, olmayan bir boşluğa
randevu vermek demek.

### `CustomerService`'in bir metodu A3.3'e alındı — çünkü detay yanıtı adı taşımıyor

`AppointmentResponseDto` **`customerName` taşımıyor**; `CalendarEntryDto` taşıyor.
Yani takvim satırında müşteri adı var, detay yanıtında yok. Müşterisi yazmayan bir
randevu detayı işe yaramaz.

İki yol vardı: adı gezinme argümanı olarak taşımak, ya da `GET customers/:id` çağırmak.
Birincisi bir ekranın gerçeğini başka bir ekranın hafızasına bağlar ve bayatlamaya
davetiye çıkarırdı. `CustomerService.get(id)` seçildi — gerçek metot, gerçek çağıran,
kendi mock'u. `search` A3.4'te, kartın tamamı A4.1'de.

Model **bilerek kırpık**: sunucu adres, kaynak, doğum tarihi, cinsiyet de gönderiyor;
A3.3'ün ihtiyacı ad ve telefon. Bugün okunmayan alanları modellemek, kullanılmamış bir
sözleşmeyi bakım yüküne çevirmek olurdu.

### Mock müşteri tablosu PAYLAŞILDI

Müşteri adları `MockBookingSeed`'in içinde bir listeydi. `CustomerService` gelince aynı
kişilerin iki yerde yaşaması gerekirdi ve ayrı tohumlanmış kopyalar, detay ekranında
takvimde görünenden **başka bir ad** göstermeye kadar giderdi — iOS'ta bir kez yaşanan
sınıftan hata. `MockCustomers` (services/mock) tek kaynak; kimlikler **liste sırasından
türetiliyor**, elle yazılmıyor (iki satıra aynı indeksi vermek iki müşteriyi tek kimlikte
birleştirirdi ve bunu ancak randevular karışınca fark ederdik).

### En sinsi hata: sürüm nereden geliyor

`POST appointments/:id/cancel` ve `.../status` **`ETag` başlığı DÖNDÜRMÜYOR** ama
yanıt gövdeleri `version` taşıyor. Ekran sürümü gövdeden almazsa, bir sonraki not kaydı
kullanıcının **kendi** değişikliği yüzünden 409 `VERSION_CONFLICT` alır — ve bu ancak
canlıda, üstelik "neden şimdi?" sorusuyla fark edilirdi.

Yazma sarmalayıcısı dönen kaydı doğrudan duruma yazıyor, yeniden `GET` yapmıyor.
Mock da iyimser kilidi uyguluyor (bayat sürüm → 409) ve iki test bunu sabitliyor:
biri gövdeden gelen sürümle not kaydının GEÇTİĞİNİ, diğeri bayat sürümün REDDEDİLDİĞİNİ.

> Web paneli bunun yerine her mutasyondan sonra yeniden okuyor. İki istemci farklı
> davranıyor ama ikisi de doğru; bizimki bir istek daha az.

### Kararlar

- **İyimser güncelleme YOK.** Sunucu geçişi reddedebilir (409 `INVALID_STATUS_TRANSITION`,
  403 `appointment:reopen`). Satırı önce değiştirip sonra geri almak, kullanıcıya bir an
  için gerçekleşmemiş bir şeyi göstermek olurdu (A2.2'deki passkey kararının aynısı).
  Bir test bunu sabitliyor: geçersiz geçişten sonra durum **değişmemiş** olmalı.
- **Okuma ile yazma ayrı ele alınır.** Okuma başarısızlığı ekranı `Failed`'a düşürür,
  yazma başarısızlığı yalnız afiş gösterir ve okunan kayda dokunmaz. Bir durum değiştirme
  denemesinin başarısız olması, kullanıcının baktığı randevuyu ekrandan silmek için sebep
  değil.
- **`Cancelled` durum listesinde YOK.** İptalin kendi sebep toplayan akışı ve kendi ucu
  var; durum satırı olarak da göstermek, aynı işe iki kapı açıp birinden sebep sormamak
  olurdu. Bir test altı durumun hiçbirinin `Cancelled` üretmediğini doğruluyor.
- **`Unknown` hiçbir geçiş üretmez.** Tanımadığımız bir durumdan nereye gidilebileceğini
  de bilmiyoruz; tahmin etmek sunucuda 409 yer.
- **Aynı duruma geçiş no-op'tur**, hata değil — sunucudaki davranış. Mock da öyle
  davranıyor ve sürüm artırmıyor.
- **"Kaynak" satırı yalnız `origin == online` ise çizilir.** Klinikte açılmış bir
  randevuda "Kaynak: Klinik" demek, hiçbir soruyu cevaplamayan bir satır olurdu.
- **Tampon dipnotu.** Tamponlar `appointments`'ta değil `resource_bookings.time_range`'de
  yaşıyor: müşteri 14:00 görür, takvim 13:55–15:10 tutar. Ekran bunu açıkça söylüyor
  ("Takvimde 1 sa 15 dk yer tutuyor — 1 sa işlem + hazırlık payı"); söylememek, "boş
  görünen" bir aralığa randevu verilmeye çalışılmasına yol açar. Mock tohumu bu yüzden
  **sıfır olmayan** tampon üretiyor — sıfır tampon dipnotu hiç sürülemez yapardı.
- **Not silme önceden söyleniyor.** Alanı boşaltıp kaydetmek notu siler; bunu kaydettikten
  sonra öğrenmek geri alınamayan bir sürpriz olurdu. `explicitNulls = false` yüzünden
  gövde elle kuruluyor: `encodeToString`, `notes: null` alanını **atlar** ve silme niyeti
  kaybolurdu.

### Kapsam dışı bırakılanlar

- **`AppointmentNotificationsSection`** (iOS'ta var) — `notifications` servisi A8.1'de.
  A3.3'te yazmak boş bir arayüz kurmak olurdu.
- **"Pakete bağla"** — A5.2. Satır modelde (`customerPackageItemId`) duruyor ve
  tamamlandığında paketten düşeceği ekranda söylenmiyor; A5.2 rozetle birlikte gelecek.
- **Erteleme** — A3.4'ün `BookingFlowScreen`'i ile aynı formu paylaşıyor; ayrı yazmak
  aynı ekranı iki kez yazmak olurdu.

---

## A3.4 — Randevu oluşturma ve erteleme ✅

**Durum:** `./gradlew check` yeşil — **231 birim testi** (204 → +27) + 5 instrumented.
R8 release APK 2.30 MB; dex baytları tarandı: üretim metinleri (`availability`,
"Seçilen saat dolu", "hazırlık payı") **var**, mock ve tohum içeriği **yok**.

Emülatörde uçtan uca sürüldü: "Yeni randevu" → müşteri araması (**"Ayse" yazınca
"Ayşe Yılmaz" geldi** — Türkçe katlama üretim yardımcısıyla) → hizmet → personel →
slot → Oluştur → takvime dönüş ve **yeni randevu listede**.

### Faz A3 kapandı

`ANDROID_DEVELOPMENT.md` §6'daki dört batch de bitti: 144 → **231 birim testi**.

### İki servisin okuma yarısı daha öne alındı

`catalog` (A7.1'den) ve `customers.search` (A4.1'den). Randevu oluşturmak hizmet
seçmeyi ve müşteri aramayı gerektiriyor; ikisi de gerçek metot + gerçek çağıran +
kendi mock'u. Düzenleme ekranları kendi fazlarında kalıyor.

Faz A3 boyunca öne alınan servisler: `booking` (A3.1), `staff` (A3.1),
`customers.get` (A3.3), `customers.search` + `catalog` (A3.4). Hepsi §6'ya işlendi.
Ortak sebep tek: **takvim, ürünün diğer her parçasına dokunan ekrandır** ve doküman
servis sırasını bağımlılıklara göre değil fazlara göre dizmişti.

### Yakalanan gerçek hata: mock uygunluk motoru yetkinliği yok sayıyordu

Emülatörde slot çipleri **"3 kişi uygun"** diyordu — ama Onur cilt bakımında yetkin
değil. Mock'un aday listesi yalnız `staffProfileId` filtresini uyguluyor, yetkinliği
uygulamıyordu.

Kullanıcı o slotu seçseydi ve geri düşüş Onur'u atasaydı, **canlı sunucu 422
`RESOURCE_UNAVAILABLE` ile reddederdi**: mock'ta doğru görünüp canlıda bozulan tam olarak
o sınıftan bir ekran. `MockBookingService.availability` artık `MockStaffService`'in
yetkinlik matrisini uyguluyor ve bir test bunu sabitliyor.

Bu, mock'un varlık sebebine dair bir ders: mock **sunucunun kurallarını** taşımak
zorunda, yalnız sunucunun ŞEKLİNİ değil.

### `BookingDraft` — kuralların yaşadığı yer

Saf bir değer tipi, Compose'suz ve servis-suz. iOS'ta bu kuralların her biri bir hata
düzeltmesiydi; ekran koduna dağılsalardı biri sessizce kaybolurdu ve kaybı ancak bir
müşteri bedava seans alınca fark edilirdi. Her kural kendi testine sahip:

- **Hizmet değişince slot düşer** — süre değişti, elde tutulan saat başka bir aralığa
  denk geliyor. Düşürmemek, seçilen saatin sessizce kaymasına yol açardı.
- **Müşteri değişince paket bağları TÜMÜYLE temizlenir** — seans hakkı müşteriye aittir;
  başka birinin hakkını taşımak bedava seans demek. (Aynı müşteriye tekrar dokunmak
  bağları korur; ayrı bir test.)
- **Slot seçimi uyumlu personeli KORUR**, değilse ilk adaya düşer — bilerek seçilmiş bir
  personeli sessizce değiştirmek yanlış olurdu.
- **Erteleme müşteriyi ve hizmet dizilimini kilitler** ve **paket bağlarını korur**:
  korumazsak erteleme, müşterinin seans hakkını sessizce çözer ve randevu ücretli olur.
- **Hizmet sırası anlamlıdır** ve sunucuya aynen gider (ardışık uygulama).
- **Yetkin personel = hizmetlerin HEPSİNİ verebilenler.** "Herhangi birinde yetkin"
  olsaydı sunucu 422 ile reddederdi ve kullanıcı bunu ancak reddedildikten sonra
  öğrenirdi.

### İki eşzamanlılık kuralı, iki ayrı mekanizma

1. **Çift dokunuşu `isSaving` bayrağı engeller**, idempotency anahtarı değil. Bir test
   ard arda iki `save()` çağırıyor ve tek bir `create` gittiğini doğruluyor.
2. **Idempotency anahtarı HER denemede yeni.** Anahtar ağ tekrarına karşıdır; düzeltilmiş
   bir gövdeyi aynı anahtarla göndermek 409 `IDEMPOTENCY_CONFLICT` verirdi. İkinci bir
   test iki denemenin iki farklı anahtar kullandığını sabitliyor.

### 409 `SLOT_CONFLICT` bir hata değil, bir bilgidir

Sunucu EXCLUDE kısıtıyla zaten yazdırmadı; kullanıcının ihtiyacı "bu saat dolu" cümlesi
değil, **alternatif saatler**. Çakışmada hata afişi gösterilmiyor: `SlotConflictScreen`
açılıyor, dolu aralıklar (tampon dahil olduğu dipnotla) ve en fazla üç öneri listeleniyor.
Öneriye dokunmak taslağı **doldurur, kaydetmez** — son sözü kullanıcı söyler; bir test
öneriden sonra hiç yeni `create` gitmediğini doğruluyor.

A3.1'de düzeltilen `SlotConflict` alan adları (`resourceId`/`from`/`to`) burada
karşılığını verdi: bir test çözülen değerlerin gerçekten dolu olduğunu sabitliyor —
düzeltilmeseydi "dolu olan" kartı boş çizilirdi ve sebebi görünmezdi.

### Kararlar

- **Sihirbaz değil, tek sayfa** (iOS ile aynı): bölümler ilerledikçe açılıyor. Adım adım
  bir sihirbaz, hizmeti değiştirmek için üç ekran geri gitmeyi gerektirirdi — ve
  rezervasyon, kliniğin en sık düzeltilen formudur.
- **Oluşturma ve erteleme TEK hedef** (`ShellRoutes.BookingFlow(rescheduleId)`). Form
  aynı; değişen yalnız kilitli alanlar ve düğme metni. İkiye bölmek aynı ekranı iki kez
  yazmak olurdu.
- **Erteleme, formu kurmadan ÖNCE randevuyu ister.** Taslak hizmet dizilimini,
  personelini ve paket bağlarını ondan kopyalıyor ve `If-Match` taze bir sürüm istiyor.
  Gezinme argümanında yalnız kimlik taşınır; argümanda taşınan bir kayıt bayatlar.
- **Oluşturduktan sonra takvime dönülür**, detaya atlanmaz: kullanıcıyı yeni bir ekrana
  bırakmak "peki günün geri kalanı?" sorusunu cevapsız bırakırdı.
- **Giriş noktaları izne bağlı** (§7.4): `appointment:write` yoksa "Yeni randevu" düğmesi
  hiç çizilmez; kapanmış randevuda "Saati değiştir" görünmez (sunucu `assertMutable` ile
  reddediyor ve reddedilecek bir düğme, yapılamayacak bir şeyi vaat etmektir).
- **Arama kısaltması (debounce) EKLENMEDİ.** Ölçülmeden eklenen bir kısaltma "yazdım ama
  liste gelmedi" hissi üretir; gerçek bir sorun ölçülürse eklenir.
- **`KlinaraChipGrid` genel bileşen olarak yazılmadı** — tek çağıranı slot ızgarası.
  A0.3'ün kuralı: ikinci çağıran doğana kadar bekle.
- **`ServiceContainer`'da `LongParameterList` gerekçeyle gevşetildi.** Bağımlılık kökünde
  uzun parametre listesi bir koku değil, tanımın kendisi: her servis tam olarak bir kez
  adlandırılıyor ve A9'a kadar on dört tane daha gelecek. Alternatif bir `Services`
  taşıyıcısıydı; o da `container.booking` yerine `container.services.booking` yazdırır ve
  okunurluğu artırmadan bir dolaylılık katmanı eklerdi.

### Kapsam dışı bırakılanlar

- **Paket seçimi** (`customerPackageItemId`) — model ve kablo gövdesi taşıyor, seçim
  arayüzü A5.2'de. Bugün bağ yalnız ERTELEMEDE korunuyor (yeni randevuda hiç kurulmuyor).
- **"Yeni müşteri ekle"** — `customer:write` ve bir müşteri formu ister; A4.2'nin işi.
- **Boş slota dokunup oluşturma** (takvimde) — iOS'ta da yok; `startingAt` bağlandı ama
  çağıran yok. Eklemek parite değil, yeni davranış olurdu.

---

## A4.1 — Liste, arama, detay ✅

**Durum:** `./gradlew check` yeşil. **254 test** (A3.4 sonunda 231'di), 37 suite, 0
başarısız. Emülatörde mock senaryosuyla uçtan uca sürüldü: liste, Türkçe arama, kart,
sistem geri tuşu, koyu tema.

Müşteriler sekmesi `ComingSoon`'dan çıktı. `CustomerService` A3'ten iki metotla
geliyordu (`get`, `search`); A4.1 `list`i ekledi ve kartın tamamını modelledi.

### Model bilerek kırpıktı, artık değil

A3.3 `Customer`ı dört alanla bırakmıştı ve gerekçesi doğruydu: randevu detayının
ihtiyacı ad ve telefondu, bugün okunmayan alanları modellemek kullanılmamış bir
sözleşmeyi bakım yüküne çevirmek olurdu. A4.1 kart ekranını yazdığı için o alanların
hepsinin gerçek bir çağıranı doğdu ve model açıldı.

**`birthDate` çıplak bir `"YYYY-MM-DD"` STRING olarak duruyor**, `Instant` değil.
Doğum günü bir takvim günüdür; `Instant`'a çevirmek cihazın diliminde gece yarısını
kaydırıp doğum gününü bir gün öteler. Emülatörde `12.05.1990` doğru çizildi.

### Kaynak ve cinsiyet enum'larında `Unknown` kolu

`AppointmentStatus`'taki kararın aynısı: sunucuya yarın eklenecek bir kaynak
(`tiktok`) ya da cinsiyet değeri, **on bin kayıtlık listeyi** çözümleme hatasıyla
düşürmemeli. `customer-forward-compatible.json` bunu çiviliyor — tanımadığımız iki
enum değeri ve fazladan bir alan taşıyor, istemci üçünde de çökmüyor.

`selectable` ayrı bir liste: `Unknown` bir seçenek değildir, bir kurtarma dalıdır.

### Plandan bilinçli iki sapma

**1. Debounce eklendi — A3.4'teki kararın tersine.**
`BookingFlowViewModel.searchCustomers` bunu bilerek eklememişti ("ölçülmeden eklenen
bir kısaltma 'yazdım ama liste gelmedi' hissi üretir") ve o gerekçe **orada hâlâ
geçerli**: randevu seçicisinde aranan küme küçük, seçim anlık. Burada durum farklı —
kabul ölçütü "10k müşteride arama gecikmesi hissedilmiyor" ve her tuş vuruşunda ağa
çıkmak sunucuya saniyede beş sorgu bindirir. 250 ms + `Job` iptali eklendi;
`debounceCollapsesKeystrokes` testi üç tuşun tek istek ürettiğini sabitliyor.

İptal ayrıca bir borcu kapatıyor: `BookingFlowViewModel`de uçuştaki istek iptal
edilmiyor ve yanıtlar sırasız dönebiliyor — kullanıcı "Ay" yazarken "A"nın sonucunu
görebilir. **A3.4'ün seçicisine dokunulmadı**; orası ayrı bir iş.

**2. Mock artık gerçekten sayfalıyor.**
`MockBookingService.appointments` bilerek tek sayfa döndürüyor ("sahte bir imleç,
imleç MANTIĞINI değil KURGUSUNU test etmek olurdu"). A4.1 **ilk gerçek cursor
tüketicisi**: `loadMore` mock sayfalamazsa hiç sürülemez. `MockCursor` sunucunun
keyset kuralını taklit ediyor — `(createdAt, id)` azalan, base64 `"<epoch>|<id>"`.

Biçim **opak**: ekran onu ayrıştırmıyor. Sunucununkiyle aynı olması da gerekmiyor,
çünkü taklit edilen şey biçim değil DAVRANIŞ — bir sayfanın bir kaydı iki kez
göstermemesi. `cursorDoesNotRepeatOrSkip` on kaydı üçerli sayfalarla geziyor ve hem
tekrar hem eksik olmadığını iddia ediyor.

Bu yüzden `MockCustomers` satırlarına `createdAt` eklendi ve **azalan** üretiliyor:
hepsine aynı anı vermek keyset sayfalamasını ayırt edilemez kılardı.

### `searchState` nullable — ve bu bir tembellik değil

`Loadable<List<Customer>>?` içinde `null` **"arama yapmıyoruz"** demek, "sonuç yok"
değil. İkisini tek tiple temsil etmek, boş bir arama sonucuyla hiç aranmamış bir
listeyi karıştırırdı: ekran "eşleşme yok" mu yazacak yoksa listeyi mi çizecek
bilemezdi. Ekranda iki ayrı boş durum metni var ve hangisinin çıkacağını bu alan
belirliyor.

`searchMasksTheListWithoutDestroyingIt` testi aramanın listeyi **gizlediğini ama
silmediğini** sabitliyor: temizlendiğinde liste yeniden çekilmiyor.

### Sayfa hatası listeyi düşürmüyor

`loadMore` başarısız olursa imleç yerinde kalıyor ve yüklenmiş kayıtlar duruyor.
Yüklenmiş 200 kaydı bir sayfa hatası yüzünden silmek, kullanıcıyı en başa döndürmek
olurdu. `failedPageKeepsTheList` bunu doğruluyor.

Bu, A3'ün "okuma hatası bölümü düşürür" kuralının bir istisnası değil, ince ayarı:
düşen şey **bir sayfa**, bölüm değil.

### Liste `branchGeneration` dinlemiyor — kasıtlı

Takvim şube değişiminde yeniden yükleniyor; müşteri listesi **yüklenmiyor**. Müşteri
KİRACI kapsamlıdır (`X-Branch-Id` bu uçlarda anlamsız) ve şube değişimi listeyi
bayatlatmaz. `branchGeneration` dinlemek, her şube değişiminde on bin kayıtlık bir
listeyi sebepsiz yeniden çekmek olurdu.

### `MockErrors` doğdu

Mock servislerin paylaştığı hata fabrikası (`notFound`, `forbidden`, `conflict`,
`versionConflict`, `validation`). Her mock kendi `ProblemDetails`ini kurarsa aynı hata
iki serviste iki farklı `code` ile çıkar ve ekran biri için doğru, diğeri için yanlış
mesaj gösterir — `MockIds`in gerekçesi neyse bunun gerekçesi de o. A4.3 ve A4.4
üzerine binecek.

### `CustomerTagChip` — `KlinaraBadge` neden kullanılmadı

`KlinaraBadge` **sabit bir ton kümesi** taşıyor (Neutral, Positive, Warning…) ve
etiketin rengi kiracının seçtiği serbest bir hex. Ton enum'una "AnyColor" eklemek,
tasarım sisteminin sözünü bozardı. Bozuk ya da eksik renk **nötr tona düşüyor**,
çökmüyor: bir etiket rengi bir ekranı düşürecek kadar önemli değil.

### Sözleşme tuzağı çivilendi: arama çıplak dizi döndürür

`GET customers/search` `{ data: [...] }` zarfı taşımıyor ve bu iOS'ta gerçek bir
hataydı (arama HER çağrıda sessizce kırılıyordu). `searchIsABareArray` testi yalnız
doğru çözümlemeyi değil, **zarf denemesinin hata vermesini** de sabitliyor — biri
"tutarlı olsun" diye zarfa sardığında test gürültüyle kırılsın diye.

Sözleşmede bunun bir eşi daha var: `GET customers/:id/opt-out` (A4.2'nin işi).

### Yeni bağımlılık: YOK

### Kapsam dışı bırakılanlar

- **"Yeni müşteri ekle"** — `customer:write` ve bir form ister; A4.2.
- **Etiket/kaynak filtresi arayüzü** — `CustomerListQuery` taşıyor ve mock uyguluyor
  (`tagFilterNarrows`), ekranda kontrolü yok. Çağıranı A4.2'de doğacak; bugün eklemek
  filtrelenecek bir etiket kümesi olmadan bir menü çizmek olurdu.
- **Kartın notlar/zaman çizelgesi/fotoğraf bölümleri** — A4.3, A4.4. Kartta sahte veri
  YOK; ne geleceğini söyleyen bir satır var.
- **Aşağı çekip yenileme** — `reload()` hazır, jest bağlanmadı.

---

## A4.2 — Düzenleme, etiket, birleştirme, iletişim tercihi ✅

**Durum:** `./gradlew check` yeşil. **308 test** (A4.1 sonunda 254'tü), 43 suite, 0
başarısız. Emülatörde uçtan uca sürüldü: yeni müşteri → mükerrer telefon 409 → serbest
numarayla kayıt → VIP etiketi → kart → opt-out → birleştirme → etiket yönetimi.

### Üç durumlu `PATCH` — bu batch'in asıl işi

`Patch<T>` (`Unchanged` / `Set` / `Clear`) sözleşmenin en sinsi tuzağını kapatıyor.
`KlinaraJson` `explicitNulls = false` ile kurulu, yani bir `String?` alanındaki `null`
gövdeden **atılır** — dolayısıyla `String?` ile bir alanı temizlemek **imkânsızdır** ve
sessizce "dokunma"ya döner. Kullanıcı adresi siler, kaydeder, adres yerinde durur; bunu
ancak müşteri şikâyet edince fark ederiz.

`LiveBookingService.updateNotes` aynı sorunu tek alan için elle çözmüştü
(`buildJsonObject { put("notes", JsonNull) }`); `Patch` onu genelleştiriyor.
`CustomerPatchTest` üç durumun **üç ayrı gövde** ürettiğini çiviliyor.

⚠️ `fullName` ve `gender` bilerek `Patch` DEĞİL: sunucu kolonları nullable değil ve
temizlenemezler. Onlara `Patch` vermek, çalışma anında 400 alacak bir niyeti derleme
zamanında ifade edilebilir kılmak olurdu.

### Sözleşmedeki İKİNCİ çıplak dizi

A4.1 `customers/search`in zarfsız olduğunu çivilemişti. `GET customers/:id/opt-out` de
zarfsız — **iki istisna var, bir değil**. `GET customer-tags` ise zarfLI. Üç uç, üç
biçim; birini diğerine benzetmek sessiz bir çözümleme hatası.

### `notifications` servisinin dar dilimi öne alındı

Doküman bu servisi A8.1'e koyuyor; **üç metodu** (`optOuts`, `createOptOut`,
`revokeOptOut`) A4.2'ye alındı çünkü kartın iletişim tercihi bölümü onlarsız çizilemez.
A3'ün `booking`/`staff`/`catalog` desenini izliyor: gerçek metot, gerçek çağıran, kendi
mock'u. Gelen kutusu, şablonlar ve tercihler A8'de bu arayüzün üstüne biner —
**bugün çağıranı olmayan on metot yazılmadı** (§A0.5).

### İzin şaşırtması: opt-out `customer:*` değil

Bölüm müşteri kartında duruyor ama uçlar `notification:read` / `notification:manage`
istiyor — kayıt bir müşteri alanı değil, bir **iletişim kaydı**. Resepsiyon bu ayrımın
canlı örneği ve `CustomerPermissionTest` onu sabitliyor: müşteriyi **yazabilir**, ileti
tercihini **görebilir**, ama **değiştiremez**.

İkisini karıştırmak, yazma izni olan herkese ileti tercihini açmak olurdu.

### Kayıt İKİ istektir ve sıra sunucunun kuralı

Etiket ucu (`PUT customers/:id/tags`) var olan bir kimlik ister, dolayısıyla yeni
müşteride önce kayıt doğmalı. İkinci istek **yalnız etiketler değiştiyse** atılır;
`CustomerEditorViewModelTest` dört ayrı kombinasyonu sayıyor (etiketsiz oluşturma → 1
istek, etiketli → 2, dokunulmamış düzenleme → 0 PATCH, yalnız etiket → 0 PATCH + 1
etiket isteği).

Boş bir `PATCH` atılmıyor: sunucuya gereksiz bir yazma ve kayda gereksiz bir
`updatedAt` demek.

### `ColorSwatchPicker` A7.1'den öne alındı

A0.3 bunu "çağıranı yok" diye A7.1'e ertelemişti ve kural buydu — bir bileşenin şekli
ancak gerçek bir çağıran karşısında kararlaştırılır. Çağıran etiket editöründe doğdu.

**Serbest bir renk çarkı değil, sabit palet.** Sunucu `#RRGGBB` doğruluyor ama asıl
mesele o değil: sınırsız renk, arka planla aynı tonda okunmaz bir etiket ve birbirinden
ayırt edilemeyen altı "yeşil" üretir. Hex'ler `KlinaraColors`'tan **kopyalanmadı**,
ayrıca yazıldı: bunlar veri, tema değil — sunucuya yazılıp web-admin'de de aynı
görünmeleri gerekiyor, temaya göre değişmemeleri gerekiyor.

### Mock artık yazıyor — ve `MockCustomers` tohuma dönüştü

Yazma gelince salt okunur bir listeden okumak mümkün değildi: oluşturulan müşteri
listede görünmeli, arşivlenen kaybolmalı. `MockCustomers.ALL` artık **tohum**;
`MockCustomerService` kendi değiştirilebilir tablosunu ondan kuruyor.

Taklit edilen sunucu kuralları (`MockCustomerWriteTest`, 14 test):
- Telefon E.164'e **normalize** ediliyor, tekillik ihlali `409`
- **Arşivleme silme değil**: kaydı döndürüyor, numarayı serbest bırakıyor, ikincisi `404`
- `PUT tags` **tam değiştirme**: boş liste "hepsini kaldır" demek
- Etiket tekilliği **katlanmış ada** göre (`VIP` ≡ `vıp`)
- Etiket adı değişince **kartlardaki rozetler de** değişiyor — eski adı taşıyan bir
  kopya bırakmak aynı etiketi iki isimle göstermeye giderdi
- Birleştirme **veri kazandırıyor**: hedefin dolu alanı kalıyor, boşu kaynaktan doluyor,
  etiketler birleşiyor, kendine birleştirme `400`

### `MockErrors` ikinci tüketicisini buldu

A4.1'de doğmuştu; `MockNotificationsService` ve etiket/telefon çakışmaları da onu
kullanıyor. Her mock'un kendi `ProblemDetails`ini kurması, aynı hatanın iki serviste
iki farklı `code` ile çıkması demekti.

### Yönetim sekmesi `ComingSoon`'dan **kısmen** çıktı

Etiket yönetimi kiracı kapsamlı bir kavram ve iOS'ta da Yönetim'de yaşıyor — kartın
altına gömmek, her karttan biraz farklı yazılmış üç "VIP" üretirdi. Ama ekranın bir
çağıranı olmalıydı (§A0.3: çağıranı olmayan kod yazılmaz), o yüzden `ManagementHome`
gerçek bir hub'a dönüştü: **tek gerçek satır** + "yakında" notu.

**Sahte satır çizilmedi.** Açılmayan bir menü, kullanıcıya var olmayan bir özellik
vaat eder. Gerçek hub A7'de.

### `SelectableChip` — `CustomerTagChip`ten neden ayrı

Biri **gösterim** rozeti (tıklanmaz, seçili hâli yok), diğeri bir **kontrol**. Tek
bileşende toplamak, salt okunur bir rozete tıklama semantiği ve TalkBack'e yanlış bir
rol vermek olurdu.

### `KlinaraButtonKind.Destructive` EKLENMEDİ

Opt-out kapatma yıkıcı görünüyor ama değil: "İzni geri ver" ile dönülebiliyor. Kırmızı
bir düğme, geri alınabilir bir tercihi kalıcı bir kayıp gibi gösterirdi. Arşivleme ve
birleştirme için `Tertiary` yeterli geldi ve onay diyalogları asıl uyarıyı zaten
taşıyor — yeni bir ton eklemek için gerçek bir ihtiyaç doğmadı.

### Yeni bağımlılık: YOK

### Kapsam dışı bırakılanlar

- **Kanal bazlı opt-out** — model ve uç taşıyor, ekran yalnız "tümü" kapsamını sürüyor.
  Kanal seçici A8.2'nin işi; bugün eklemek, tek kanalı kapatmanın ne anlama geldiğini
  gösterecek bir mesaj günlüğü olmadan yarım kalırdı.
- **Etiket/kaynak filtresi arayüzü** — `CustomerListQuery` taşıyor, mock uyguluyor
  (`tagFilterNarrows`), ekranda kontrol yok. A4.1'den devreden madde.
- **Etiketi yeniden adlandırmanın listeyi tazelemesi** — kart açılınca doğru geliyor;
  açık duran bir listede rozet eski adla kalabilir. Gerçek bir sorun ölçülürse eklenir.
- **Doğum tarihi seçici** — alan `YYYY-MM-DD` metin girişi. `DatePicker` şube saat
  dilimine sabitlenmeli (gece yarısı kayması) ve bu ayrı bir iş; biçim ekranda yazıyor.

---

## A4.3 — Notlar ve zaman çizelgesi ✅

**Durum:** `./gradlew check` yeşil. **326 test** (A4.2 sonunda 308'di). Emülatörde
sürüldü: klinik/genel not rozetleri, sürüm bilgisi, filtre çipleri, karma çizelge ve
**bilinmeyen türün görünür çizilmesi**.

### `If-Match` AÇILIŞ sürümüyle gidiyor

Sözleşmenin en ince maddesi bu. `PATCH notes/:id` `If-Match` zorunlu tutuyor ve
gönderilen sürüm notun **açıldığı andaki** sürüm olmalı. Store'un güncel sürümünü
göndermek kilidi **etkisiz kılardı**: başkasının bu arada yazdığı metnin üstüne
sessizce yazardık ve iyimser kilit hiçbir şeyi korumamış olurdu.

`NoteEditorScreen` `openedVersion`ı `remember(note?.id)` ile bir kez yakalıyor ve ekran
boyunca değiştirmiyor.

Sürüm bu arada arttıysa **ön haber** veriliyor ("başkası değiştirdi, kaydederseniz
çakışma alacaksınız"). Bu bir kilit değil ve kullanıcıya öyle de denmiyor — amaç
kullanıcının boşuna paragraf yazmasını önlemek.

### Sürümü YALNIZ metin değişimi artırıyor

`customer_notes_revision` trigger'ının koşulu `new.body is distinct from old.body`.
Mock her düzenlemede artırsaydı, `kind` ya da `customerVisible` değiştiren bir kaydetme
elde tutulan ETag'i gereksiz yere geçersiz kılar ve ekran **hiç yaşanmayacak** bir
çakışma uyarısı gösterirdi. `flagChangeLeavesTheVersionAlone` bunu çiviliyor.

### Klinik not kapısı bir DÜRÜSTLÜK kapısı

`treatment` ve `internal` notlar `customer.medical:read` olmayana **sorgudan hiç
çıkmıyor** ve yanıtta "gizlendi" bayrağı YOK. Kısalmış bir liste göstermek,
resepsiyona *"bu müşterinin tedavi notu yok"* demektir — kliniğin en hassas verisi
hakkında yanlış bilgi.

Ekran bu sessizliği **açık bir satırla** kırıyor: "Klinik notları görme yetkiniz yok;
bu listede yalnız genel notlar var. Müşterinin klinik notu OLABİLİR."

Aynı daraltma **zaman çizelgesinde de** uygulanıyor (`timelineRespectsMedicalNarrowing`):
izni bir kapıda uygulayıp diğerinde unutmak, gizlenen metnin başka bir kapıdan
sızması olurdu.

Sunucu izinsiz kullanıcıya `404` veriyor, `403` değil — `403` "var ama göremezsin"
derdi ve notun **varlığını** sızdırırdı. Mock bunu da taklit ediyor.

### Zaman çizelgesinde `unknown` kolu — bir konfor değil, hayatta kalma şartı

Faz 5, 6 ve 7 bu akışa kendi kolunu ekleyecek. Bilinmeyen bir `kind` çözümlemeyi
patlatsaydı **eski istemci yeni sunucuda müşteri kartını HİÇ açamazdı**: tek bir yeni
olay türü tüm kartı kilitlerdi.

Olay yutulmuyor da — "Bu sürümde gösterilemeyen kayıt" olarak, **uyarı tonlu bir
rozetle** çiziliyor. Eksik bir geçmiş, tam bir geçmiş gibi görünmemeli.
Mock tohumu bilerek bir `loyalty_award` taşıyor ki bu yol elle de sürülebilsin.

### İki dürüstlük dipnotu

1. **Tahsilat bu akışta yok** (sunucudan gelmiyor, Faz 6'dan devreden). Sessizce
   gizlemek "bu müşteriden hiç tahsilat yapılmamış" izlenimi verirdi.
2. **Klinik notlar izinsiz kullanıcıda listeye dâhil değil** — çizelgenin dipnotu da
   bunu söylüyor.

### `occurredAt` UTC geliyor, takvim şube offset'i

`+00:00` ve `+03:00` **aynı anı** gösteriyor ve `InstantSerializer` ikisini de
çözüyor. iOS'ta bu bir varsayım hatasıydı ve "saatler 3 saat kaymış" olarak
keşfedilecekti; test iki biçimin aynı ana çözüldüğünü sabitliyor.

### `payload` bilerek çözümlenmemiş

Türe göre beş farklı şekil taşıyor. Hepsini sealed bir hiyerarşiye açmak, bugün
okunmayan alanları modellemek olurdu (A3.3'ün `Customer`ı kırpık bırakma gerekçesi).
Ekranın ihtiyacı olan üç-dört alan `string()`/`long()` ile okunuyor ve eksik anahtar
`null` dönüyor — Faz 5/6 buraya dokunmadan alan ekleyebilir.

### Bir not hem nottur hem çizelge olayı

Yazma sonrası **ikisi birden** tazeleniyor. Yalnız birini tazelemek iki tutarsız liste
bırakırdı. Filtre değişince çizelge **baştan** yükleniyor: yeni filtre altında eskiyi
biriktirmek, iki farklı sorgunun sonucunu tek listede karıştırmak olurdu.

### `KlinaraTextEditor` A0.3'ten geldi

Çağıranı not editöründe doğdu. `KlinaraTextField`ten farkı yalnız `maxLines` değil:
**`ImeAction.Default`** taşıyor (Enter satır atlar, formu göndermez) ve minimum
yüksekliği var — klinik bir not çoğunlukla birkaç cümledir.

### Yeni bağımlılık: YOK

### Kapsam dışı

- **Randevuya bağlı not** (`appointmentId`) — model ve uç taşıyor, arayüzü yok;
  çağıranı randevu detayında doğacak.
- **Tarih aralığı filtresi** — `kinds` bağlandı, `from`/`to` bağlanmadı (iOS'ta var).
- **Revizyondan geri alma** — sürümler görüntüleniyor, "bu sürüme dön" yok; sunucuda
  da böyle bir uç yok.

---

## A4.4 — Fotoğraf ve dosyalar ✅

**Durum:** `./gradlew check` yeşil. **345 test** (A4.3 sonunda 326'ydı), 47 suite.
Emülatörde sürüldü: fotoğraf/belge kartlarının ayrı izin kapıları, öncesi/sonrası
ekranı, boş durum metinleri.

### Üç adımlı zincir ve onu koruyan mock

`presign` → imzalı **PUT** → `confirm`. Mock üç sunucu kuralını zorluyor:

- **`presign` DB'ye hiçbir şey yazmıyor** — yarıda kalan yükleme asılı "pending" satır
  bırakmasın (`presignWritesNothing`).
- **Yükleme atlanırsa `confirm` reddediliyor** — `presign` bir söz değil, bir izindir
  (`confirmWithoutUploadIsRejected`).
- **Anahtar öneki doğrulanıyor** — başka müşterinin yoluna yazma denemesi `403`
  (`crossCustomerKeyIsForbidden`).

Ayrıca **boyut ve MIME nesnenin KENDİSİNDEN** okunuyor, istemci beyanından değil:
test istemciye bilerek yalan söyletiyor (10 bayt diyor) ve gerçek boyutun kaydedildiğini
doğruluyor.

### Küçültme PİKSEL cinsinden — iOS'un hata #2'si

iOS'ta `UIImage.size` **nokta** olduğu için 3x ölçekli bir görselde nokta hesabı
hedefin üç katını üretiyordu: "2048'e indirildi" denen fotoğraf 6144 piksel kalıyordu.
Android'de `Bitmap.width` zaten piksel; `ImageResize` bu gerçeği **açıkça** yazıyor ki
biri "dp ile hesaplayalım" demesin.

Sığmazsa **null dönüyor** — sunucunun reddedeceği bir nesneyi yüklemeye çalışmak,
kullanıcıyı anlamsız bir hatayla karşılamak olurdu.

### Tip SİHİRLİ BAYTTAN tespit ediliyor

Uzantı ikinci sırada. `.jpg` diye adlandırılmış bir PDF, PDF'tir. Bilinmeyen içerik
`null` dönüyor ve **varsayılan tip ATANMIYOR**: tanımadığımız bir dosyayı JPEG sanmak,
sunucunun beyaz listesini istemcide sessizce delmek olurdu.

`image/svg+xml` beyaz listede **yok** — SVG çalıştırılabilir içerik taşır.

### Hazır olmayan `thumb` 409 veriyor ve TAM BOYUTA DÜŞMÜYOR

Sessiz düşüş, 30 fotoğraflı bir ızgaranın farkında olmadan 25 MB'lık nesneler indirmesi
demekti. `409` bir hata değil **"henüz değil"**: yer tutucu çiziliyor ve **bir kez**
gecikmeli tazeleniyor — **sonsuz yoklama yok**.

### Erişim kaydı: `view` ile `download` ayrı

`download-url` HER çağrıda `customer_record_access_log`'a yazıyor. Adres liste
render'ında çekilseydi bir kaydırma onlarca sahte "görüntüledi" üretir ve "kim hangi
kaydı gördü" sorusu **cevaplanamaz** hâle gelirdi.

Bu yüzden `ThumbnailCache` **adresi değil GÖRÜNTÜYÜ** önbelleklıyor (imzalı adres 5
dakikalık; onu saklamak ölü bağlantı önbelleği tutmak olurdu) ve **tam boyut asla
önbelleğe alınmıyor** — her açılış bir `download` kaydı düşürmeli.

Önbellek **yalnız bellekte** (`LruCache`, 200 girdi): bir klinik fotoğrafın küçük hâli
de klinik fotoğraftır ve diskte artakalmamalı (§7.9).

### iOS'un düzeltilmiş hatası tekrarlanmadı — ve emülatörde doğrulandı

iOS'ta yükleme sayfaları fotoğraf kartına asılıydı ve `customer.medical:*` izni
olmayan kullanıcıda **"Belge ekle" düğmesi ölüydü**. Burada fotoğraf ve belge **ayrı
kartlar, ayrı izinler**.

`manager` rolü bunun canlı örneği: `customer.medical:read` var, `:write` YOK.
Emülatörde fotoğraf kartı çiziliyor, **"Fotoğraf ekle" görünmüyor**, "Belge ekle"
çalışıyor. Tek kartta olsalardı belge yükleme de ölürdü.

### `FLAG_SECURE` klinik fotoğraf ekranlarında

Bir hasta fotoğrafının son kullanılanlar ekranında küçük resim olarak durması, kliniğin
kontrolü dışına çıkan bir sağlık verisidir. Bayrak ekrandan **çıkarken kaldırılıyor**:
uygulamanın geri kalanında ekran görüntüsü meşru bir ihtiyaç.

**Paylaş düğmesi YOK** (§9, kalıcı karar).

### Boş slot izinsiz kullanıcıda ATIL

Öncesi/sonrası slotu yalnız `customer.medical:write` varken tıklanabilir. Tıklanabilir
gösterip izin hatası vermek, hiç dokunamamaktan kötüdür (§7.4). Emülatörde `manager`da
"Yeni grup" düğmesi de çizilmiyor.

Gruba yüklerken grup ve konum **önceden seçili gidiyor ve tekrar sorulmuyor** — iki kez
sormak, iki seçimin ayrışmasına izin vermekti.

### PDF: platform `PdfRenderer`, üçüncü parti YOK

Bir PDF kütüphanesi sağlık verisi dosyasını okuyacaktı; bağımlılık yüzeyi bilinçle
sıfır (§3). Geçici dosya `onDispose`'da **siliniyor** — silinmiş bir belge sandbox'ta
yaşamaya devam etmemeli. En fazla 20 sayfa render ediliyor: bir onam metni 200 sayfa
olabilir ve tamamını belleğe açmak gerekmiyor.

### ⚠️ Plandan sapma: Coil EKLENMEDİ

Plan Coil 3'ü öngörüyordu ve katalog girdisi de yazılmıştı. **Kaldırıldı: çağıranı
doğmadı.**

`ThumbnailCache` elle yazıldı (OkHttp + `BitmapFactory` + `LruCache`) ve bu tesadüf
değil, daha doğru çıktı: Coil'in disk önbelleğini **kapatmayı unutmak** sağlık
verisini diske yazmak olurdu ve "kapattığımızı" ancak bir denetimde fark ederdik. Elle
yazılan önbellekte disk yolu **hiç yok** — yapısal olarak imkânsız.

Fotoğraf sayısı da bunu destekliyor: bir müşteri kartında onlarca fotoğraf var, binlerce
değil; Coil'in getirdiği ağ katmanı, disk katmanı ve dönüşüm hattı bu ölçekte
kullanılmayan yüzeydi. **"§3 öngörüyor" bir gerekçe değil**, bir tahmindi.

### Yeni bağımlılık: CameraX (4 modül)

`camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view`. Gerekçe: klinik
fotoğrafı çoğu kez **o an** çekiliyor ve Photo Picker yalnız galeriyi okuyor.
`CAMERA` izni manifest'e eklendi, `uses-feature required="false"` ile — kamerası
olmayan bir cihazda uygulama yine kurulabilmeli.

**Photo Picker izin GEREKTİRMİYOR** ve bu bilinçli bir tercih: `READ_MEDIA_IMAGES`
istemek, kullanıcının tüm galerisine erişmek demekti; `PickVisualMedia` yalnız
seçilen dosyayı veriyor.

### Kapsam dışı

- **CameraX ile canlı çekim ekranı** — bağımlılık ve izin hazır, önizleme/çekim
  arayüzü bağlanmadı. Photo Picker yolu uçtan uca çalışıyor; kamera yüzeyi kendi
  başına bir ekran ve ayrı bir doğrulama turu istiyor.
- **`takenAt` seçimi** — model ve kablo taşıyor, arayüzü yok.
- **Grup düzenleme/silme** — oluşturma var, düzenleme yok (sunucuda da uç yok).
- **`customer_record_access_log` okuma** — rapor ucu Batch 7.4'te.

---

## A5.1 — Paket tanımları ✅

**Durum:** `./gradlew check` yeşil. **369 test** (A4.4 sonunda 345'ti), 51 suite.
Emülatörde `Çok şubeli` senaryosuyla sürüldü: Yönetim → Paketler listesi (indirim
rozeti, üstü çizili liste fiyatı, şube ADI rozeti, "Süresiz"), yeni tanım (ad yazdıkça
slug türüyor, kalem adımlayıcısı, canlı indirim önizlemesi 14.400 − 12.000 = 2.400 ₺),
kaydedince listeye dönüş ve yeni tanımın görünmesi; **satılmış** lazer paketini emekliye
ayırmak onu arşivlemedi, "Pasif" rozetiyle listede bıraktı.

### `PackagesService` tek arayüz, ama metotları batch batch geliyor

iOS'un dört bölümlü tek protokolü aynen alındı (tanım / satış-defter / operasyon /
rapor): sunucuda dört controller var ama istemcide hepsi aynı ekran ailesini besliyor.
A5.1'de arayüzde **yalnız tanım metotları** var — satış, defter ve raporlar kendi
batch'lerinde, kendi çağıranlarıyla ekleniyor (§5.1 boş arayüz yasağı).

### `revision` ile `version` iki ayrı sayaç ve mock ikisini ayrı sürüyor

`revision` satışı etkileyen alan değişince artar ve satılan paket onu snapshot olarak
taşır; `version` her yazmada artar ve `If-Match`'e gider. Seed'deki ikinci tanım
bilerek `revision = 2, version = 3` — eşit olsalardı karıştırıldıkları hiç görünmezdi.
`revisionBumpsOnlyOnSaleAffectingChanges` ad değişiminin revizyonu artırmadığını,
fiyat değişiminin artırdığını çiviliyor.

### "Süresiz" `null`'dır, `0` değil — ve gövdede AÇIK `null` gider

`validityDays` üç durumlu (`Patch<Int>`). Mevcut `putPatch` değeri daima metne
çeviriyordu; `"365"` göndermek sunucuda 400 alırdı. İmzayı değiştirmek yerine
`CustomerPatch.kt`'e `putPatchElement` eklendi — var olan çağıranlar dokunulmadan kaldı.
`updateBodyDistinguishesClearFromUnchanged` üç hâli (yok / `null` / sayı) ayrı ayrı
doğruluyor; mock `0`'ı 400 ile reddediyor (`validityClearVsZero`).

### Emekliye ayırmanın İKİ sonucu var ve ekran tahmin etmiyor

`DELETE` satılmamış tanımı arşivler, satılmışı yalnız pasife alır ve `204` döner —
hangisinin olduğunu yanıt söylemiyor. ViewModel kaydı **yeniden çekiyor** ve ona göre
listeden düşürüyor ya da "Pasif" gösteriyor. Onay diyaloğu da iki sonucu yazıyor;
kullanıcı "sildim" sanmasın. Yeniden çekme `runCatching` ile DEĞİL, `ApiError`
yakalanarak yapılıyor: `runCatching` iptal istisnasını da yutar.

### Şube kapsamı dışlama değil, SORU

`GET package-definitions?branchId=` şube kısıtı olmayan tanımları da döndürüyor
(`package-definitions.repository.ts`). Mock aynısını yapıyor
(`branchScopeIncludesUnscoped`) ve kapsam **istemcide süzülmüyor**: sayfalı bir listede
o şubenin paketi ikinci sayfada kalabilir.

### Tasarım sistemine eklenenler

`KlinaraStepperRow`, `KlinaraMoneyField`, `KlinaraSelectableRow`,
`KlinaraSearchablePicker`, `KlinaraToggleRow` — hepsi `ComponentGalleryScreen`'de.

- **Adımlayıcı aralık dışındaki adımı sunmuyor** (düğme pasifleşiyor). A5.3'te kalan
  hakkı eksiye düşürecek bir `−` hiç olmayacak.
- **`KlinaraMoneyField` `Money`'yi import ETMİYOR**: `parse`/`format` parametre olarak
  geliyor. `designsystem/` bugüne kadar `services/`'e hiç bağımlı değildi ve §3'ün
  `:core:designsystem` ayrımı tetiklendiğinde bir döngü doğmamalı.
- `material-icons-core`'da "eksi" yok; `−`/`+` metin olarak çiziliyor ve "azalt"/"artır"
  diye duyuruluyor. Bir adımlayıcı için `material-icons-extended` eklenmedi (§7.7).

### Plandan / iOS'tan sapmalar

- **Tanım listesi oturum ömürlü değil.** iOS'ta `PackageDefinitionStore` oturum boyunca
  yaşıyor ve satış sayfasıyla paylaşılıyor. Android'de oturum ömürlü store kalıbı yok;
  her ekran kendi ViewModel'ini alıyor. Editörden dönen kayıt route ile geri
  taşınmıyor: gezinme listeyi yeniden kurunca `LaunchedEffect` koşuyor ve liste
  **sessizce** tazeleniyor (eldeki liste "yükleniyor"a düşmüyor —
  `sameScopeRefreshesSilently`). Bedeli bir istek; kazancı başka oturumun yazdığını da
  görmek.
- **Emekliye ayırma `swipeActions` değil, kartta açık bir düğme.** Kaydırma jesti
  Android'de keşif kalıbı değil ve TalkBack kullanıcısına hiç görünmez.
- `ShellTab.MANAGEMENT_PERMISSIONS`'a **`package:read`** eklendi. Bugün her paket izni
  olan rol sekmeyi başka bir izinle zaten görüyor; ama paket ekranına götüren izin
  sekmeyi de açmalı — iOS'taki muhasebe hatasının sınıfı "şans eseri doğru" bir koşulla
  korunmaz.

### Yeni bağımlılık: YOK

### Kapsam dışı

- **Tanım listesinde sayfalama sonsuz kaydırma değil, "Daha fazla yükle" düğmesi.**
  Tanım sayısı kiracı başına onlarla sınırlı; kaydırma tetikleyicisi A5.4'te süre
  dolumu raporunda (binlerce satır olabilen tek liste) geliyor.
- **Hizmet seçici pasif hizmetleri hiç göstermiyor** — sunucu pasif hizmeti kalem
  olarak reddediyor; göstermek, seçilip reddedilecek bir satır sunmak olurdu.

---

## A5.2 — Satış, bağlama, müşteri paketleri ✅

**Durum:** `./gradlew check` yeşil. **391 test** (A5.1 sonunda 369'du), 54 suite.
Emülatörde uçtan uca sürüldü: Ayşe'nin kartında "7/12 seans kaldı · Lazer epilasyon: 6/10
· Cilt bakımı: 1/2"; paket detayı ve defter (satış, kullanımlar, ters kayıt rozeti,
manuel düzeltme gerekçesi); **Bugün → Ayşe'nin 09:00 cilt bakımı → "Pakete bağla"**
yalnız cilt bakımı hakkını listeledi (lazer DEĞİL), dipnot "seans randevu tamamlandığında
düşer" dedi; bağlamadan sonra kalan hak değişmedi; randevu Geldi → İşlemde → Tamamlandı
yapılınca kart **0/2**'ye düştü ve deftere yeni bir `−1 Kullanım` satırı girdi. Kart
üzerinden "5 Seans Cilt Bakımı" satışı: önizleme (Süresiz · Devredilemez · indirim) →
satış → karta dönüşte yeni paket en üstte.

### Kalan hak mock'ta da bir sayaç DEĞİL — defterin toplamı

Fazın çıkış ölçütü "istemci sayacı sunucu defteriyle ayrışmıyor". Mock'ta bunu yapısal
kıldık: `MockPackagesService.append` her satırdan sonra kalem kalanını **defter
satırlarının toplamından** yeniden hesaplıyor; hiçbir yerde `remaining -= 1` yok. Seed de
kalanı elle YAZMIYOR — Ayşe'nin paketi satış anındaki hâliyle kurulup defter satırları
aynı yazma noktasından geçiriliyor. `assertLedgerMatches` her testte her kalem için
"satırların toplamı == kalan hak ve ≥ 0" diyor.

İstemci tarafında da kalan hak **hiçbir akışta yerelde güncellenmiyor**: kart, detay ve
satış dönüşleri gezinme ekranı yeniden kurduğunda sunucudan taze geliyor. Tazeleme hatası
eldeki listeyi silmiyor (`refreshFailureKeepsList`).

### Tamamlanma ile seans düşme AYNI "transaction"

Sunucuda bağlı bir randevunun `completed`'a geçişi paketten seans düşürür ve hak
yetersizse **durum değişikliği de reddedilir**. Mock bunu `MockBookingService`'e eklenen
bir kanca (`PackageConsumptionHook`) ile kuruyor: defter önce, sonra durum.
`exhaustedBlocksCompletion` iki randevuyu tek kalan bakım hakkına bağlıyor; ikincinin
tamamlanması `PACKAGE_EXHAUSTED` alıyor **ve randevu `İşlemde` kalıyor**.

Yeniden açma (`completed → in_progress`) satırı SİLMİYOR, onu geri alan bir ters kayıt
ekliyor (`completionConsumesAndReopenReverses`). Booking → packages doğrudan bağımlılığı
yerine kanca: paketler zaten bağlama için booking'e bakıyor ve iki mock birbirine
kilitlenirdi.

### Kuruş kaybolmuyor

Satış tutarı kalemlere liste ağırlığıyla **largest-remainder** ile dağıtılıyor (sunucudaki
`allocateMinor`): 12.500 ₺ → 11.119,63 + 1.380,37. `allocationNeverLosesAKurus` ağırlıksız
(hepsi sıfır) durumu da çiviliyor.

### Idempotency anahtarı ekranın değil SATIŞIN ömründe

`SellPackageViewModel` ve `BindPackageViewModel` anahtarı doğarken üretiyor.
`sellRetryAfterLostResponseDoesNotDuplicate` gerçek senaryoyu kuruyor: sunucu satışı
YAZIYOR ama yanıt kayboluyor; kullanıcı tekrar basıyor; iki deneme **tek anahtar**, tek
paket.

### Çıplak dizi ve bilinmeyen defter türü

`package-entitlements` zarfsız döner — fixture'ı `ListEnvelope` ile çözmeye çalışan test
**başarısız olmayı** bekliyor. Bilinmeyen `entryType` `Unknown`'a düşüyor ve deltası
korunuyor: eksik bir defter tam görünmesin.

### Plandan / iOS'tan sapmalar

- **`PackageLedgerScreen` ayrı bir hedef değil, `PackageLedgerSection`** — iOS'ta da
  defter detayın içinde bir görünüm. Ayrı route, aynı veriyi ikinci bir ViewModel'le
  çekmek olurdu; "daha eski kayıtlar" düğmesi sayfalamayı detayın içinde yapıyor.
- **Paket bölümü `CustomerPackagesCard` içinde kendi ViewModel'ini kuruyor** ve izin yoksa
  hiç çizilmiyor. `CustomerDetailScreen`'e gömmek onu detekt'in karmaşıklık eşiğine
  itiyordu; eşiği yükseltmek yerine blok ayrıldı.
- **Randevu satırı hizmet ADINI taşımıyor**; bağlama sayfası başlığı hakların taşıdığı
  hizmet adına düşüyor.
- **`MockCustomerService.snapshot()` ve `MockBookingService.current()` `internal` oldu** —
  paket mock'u müşteri varlığını ve randevu durumunu okumak zorunda.
- `ApiError.MESSAGES`'a `PACKAGE_EXHAUSTED` ve `PACKAGE_EXPIRED` için eyleme dönük Türkçe
  metin eklendi; iOS paritesi (`Phase5DecodingTests`'in "Türkçe mesajı vardır" testi).

### Yeni bağımlılık: YOK

### Kapsam dışı

- **Rezervasyon formunda paket seçimi.** `AppointmentServiceInput.customerPackageItemId`
  kabloda var; bağlama bugün randevu detayından yapılıyor. Oluşturma anında seçim iOS'ta
  da yok.
- **Mock'ta müşteri paketleri ve defter sayfalanmıyor** (tek sayfa). İstemci imleci okuyor
  ve "daha fazla" düğmesi çiziyor; mock'u sayfalamak bir kartta 2–3 paket için değer
  üretmiyordu.

---

## A5.3 — İade, devir, düzeltme ✅

**Durum:** `./gradlew check` yeşil. **406 test** (A5.2 sonunda 391'di), 57 suite.
Emülatörde `manager` ile sürüldü: paket detayında üç işlem düğmesi; **kısmi iade** (2
lazer seansı) tahmini **2.223,92 ₺** gösterdi — satış tahsisinden (111.196 × 2), liste
fiyatından (1.450 × 2) değil — iade sonrası lazer 6 → 4 ve özet dipnotu "Kasa hareketi
henüz oluşturulmadı (Faz A6)"; **devir** (1 lazer seansı, Zeynep'e): kaynak 4 → 3,
Zeynep'in kartında 1/1'lik yeni paket, **aynı geçerlilik sonu** (10 Temmuz 2027) ve
"Bu paket bir devirle oluştu".

### Üç izin, üç ayrı kapı — ve matrisi test sürüyor

`package:refund` ve `package:transfer` `package:write` üzerine BİNMEZ. `AppSession.packagePermissions`
üçünü tek yerde çözüyor; `availableOperations` saf bir fonksiyon ve `PackagePermissionTest`
altı rolü üretilmiş `RolePermissions`'tan sürüyor: owner/manager üçü, **resepsiyon yalnız
düzeltme**, **muhasebe yalnız iade**, uygulayıcı hiçbiri. Mock yalnız manager ile
practitioner'ı sürebildiği için (A2.1 kararı) matris emülatörde değil burada.

Yapılamayan işlem **pasif düğme değil, hiç çizilmiyor** ve sebep dipnotta: kapanmış paket,
süresi dolmuş paket ("durum hâlâ aktif ama tarih geçti" dahil — kapatma bir cron işi),
devredilemez satılmış paket. `PackageOperationHost` izni **bir kez daha** kontrol ediyor:
hedef derin bağlantıyla açılabilir ve düğmeyi gizlemek tek başına bir kapı değil.

### Çıkış ölçütü bu batch'te çivilendi

`MockPackageOperationsTest`'in her testi sonunda "her kalem için defter toplamı == kalan
hak ≥ 0" doğrulanıyor. Önemlileri:

- **Atomiklik:** lazer +1 ve bakım −2 (kalan 1) BİRLİKTE gönderilince `PACKAGE_EXHAUSTED`
  ve **hiçbir kalem değişmiyor** — birinci satır yazılıp ikincide patlamıyor
  (`adjustBeyondRemainingIsRejectedAtomically`).
- **Tam iade paketi kapatıyor**, sonraki her işlem `PACKAGE_EXPIRED`.
- **Aynı anahtarla ikinci iade yazılmıyor**; kalandan fazla iade hiçbir satır yazmadan
  reddediliyor.
- **Devirde iki tarafın toplamı korunuyor** ve devredilen hakkın karşılığı kaynağın
  tahsisinden taşınıyor (111.196 × 3 = 333.588).

### İstemci yerel kopya GÜNCELLEMİYOR — iki yanıt da buna zorluyor

`refund` yanıtı paketi hiç taşımıyor (tutar ve seans sayısı döner); `transfer` yanıtı
KAYNAĞI değil **hedefin yeni paketini** döner. İkisinden de kaynağı "yerelde düzeltmek"
tahmin olurdu. İşlem ekranı başarıda kapanıyor, detay ve kart dönüşte sunucudan taze
geliyor.

### Bayat sürüm: tazele, formu KORU

İki kişi aynı paketi düzeltirse ikincisi `VERSION_CONFLICT` alıyor; ViewModel paketi
kendiliğinden tazeliyor ki bir sonraki deneme doğru `If-Match` ile gitsin, ama
**seçimler ve gerekçe yerinde kalıyor** — kullanıcı yeni kalana bakıp karar veriyor
(`versionConflictRefreshesAndKeepsForm`).

### iOS'a bildirilecek fark (§7.8)

iOS `PackageOperationModels.swift` "üç gövde de hem `If-Match` hem `Idempotency-Key` ister"
diyor. Sunucu (`package-operations.controller.ts`) **`adjust` için `Idempotency-Key`
okumuyor**; yalnız `refund` ve `transfer` okuyor. Android arayüzü bunu imzada yansıtıyor:
`adjust(id, version, input)` anahtar almıyor. iOS'un çağrısı zararsız (başlık yok sayılıyor)
ama not yanıltıcı.

### Plandan sapmalar

- **Üç sheet, TEK hedef:** `ShellRoutes.PackageOperation(packageId, operation)`. Yükleme,
  taze sürüm, gerekçe ve hata ortak; değişen form ve izin. `PackageAdjustSheet`,
  `PackageRefundSheet`, `PackageTransferSheet` ayrı composable'lar olarak duruyor,
  `PackageOperationScaffold` iskeleti taşıyor. iOS `KlinaraFormScaffold` karşılığı
  tasarım sistemine GİRMEDİ — tek çağıranı bu üç ekran.
- **Devir hedefi sunucu aramasıyla** (`customers/search`, `q ≥ 2`, 300 ms gecikme, önceki
  istek iptal) seçiliyor; iOS tüm müşteri listesini çekip istemcide süzüyor. Binlerce
  müşterili bir kiracıda istemci süzmesi A4.1'de zaten reddedilmişti.

### Yeni bağımlılık: YOK

### Kapsam dışı

- **İade tahsilatı / kasa hareketi** — A6.2. İade `pending` bir yükümlülük yazıyor ve
  ekran bunu gizlemiyor (kart rozeti "İade ödemesi bekliyor", özet dipnotu).
- **Devirde hedef için yeni müşteri oluşturma** — hedef var olan bir müşteri olmalı.

---

## A5.4 — Paket raporları ✅

**Durum:** `./gradlew check` yeşil. **418 test** (A5.3 sonunda 406'ydı; A4.4 sonunda 345),
59 suite. Emülatörde iki rolle sürüldü. **`manager`** (Nişantaşı): yükümlülük 12.078,18 ₺
· 2 paket · 12 seans (Bodrum'daki paket kapsam dışı — şube filtresi), hizmet kırılımı;
süre dolumu "1 Eylül 2026 – 30 Eylül 2026" etiketiyle Fatma'nın paketi ve tutarı; dönem
kullanımında cilt bakımı "Tüketilen 1 seans". **`Uygulayıcı kapsamı`** (practitioner):
rapor girişinde yükümlülük satırı YOK ve sebebi yazıyor; süre dolumunda tutar **"—"**;
müşteri kartında paket bölümü görünüyor ama "Paket sat" ve paket detayında işlem kartı yok.

### Yarı açık aralık: sunucuya `[1 Eyl, 1 Eki)`, kullanıcıya "1 – 30 Eylül"

`PackageReportsViewModel` dönemi daima ayın ilk anından ertesi ayın ilk anına kuruyor
(`BranchClock.startOfMonth` + `addingMonths`, şube saatinde); etiket üst sınırın **bir
gün öncesini** yazıyor. `periodIsHalfOpenAndLabelInclusive` iki tarafı ayrı çiviliyor;
mock da `to`'yu dışarıda bırakıyor — tam `to` anında dolan paket o dönemde görünmüyor,
sonrakinde görünüyor (`expiringIsHalfOpen`).

### `null` tutar "—", sıfır DEĞİL — iki ayrı yerde

`report.revenue:read` olmayan rolde (practitioner, receptionist) sunucu süre dolumu
satırlarındaki tutarı `null`'lıyor ve yükümlülük raporunu 403 ile kapatıyor. Mock ikisini
de yapıyor (`canReadRevenue` kancası senaryonun rolünden besleniyor), ekran:

- süre dolumunda `null`'u **"—"** yazıyor (`amountLabel`) — "0 ₺" taşınmayan bir borç
  iddiası olurdu;
- rapor girişinde yükümlülük satırını **çizmiyor** ve "Parasal raporlar bu rolde
  görüntülenemez" diyor — eksik ile kapalı arasındaki fark;
- hedef derin bağlantıyla açılsa bile izinsiz rol sunucuya 403 için gitmiyor.

Fixture'da iki hâl birden var: açık `"outstandingMinor": null` ve alanın HİÇ olmadığı satır.

### Süre dolumu imleci OKUNUYOR ve sayfalar kayıpsız

iOS'ta rapor bir kez `pageInfo` okunmadan ilk 50 satırda sessizce kesilmişti.
`expiringPaginationIsLossless` `limit = 1` ile sayfaları yürüyüp sayfasız yanıtın
**aynısını** aldığını doğruluyor; keyset sırası `(expiresAt, id)` artan (eşit tarihte
`id` olmadan sınırdaki kayıt ya iki kez çıkar ya hiç çıkmaz).

### Kullanımda ters kayıt tüketimden DÜŞÜYOR

Rakamlar defterden; geri alınmış bir tamamlama "tüketildi" sayılmıyor (−1 ve onun tersi
+1 → net 0). Ayşe'nin defterinde 4 kullanım + 1 ters kayıt → 3 (`usageSubtractsReversals`).

### Mock ikiye bölündü — detekt'in büyük sınıf eşiği, ama sunucunun çizgisinden

Dört controller'ın mock'u tek sınıfta 780 satırı geçti ve `LargeClass` verdi. Eşik
susturulmadı; iki ayrım yapıldı ve ikisi de sunucuda zaten var:

- **`MockPackageLedger`** — tablolar ve TEK yazma noktası (`apply`/`append`), yani
  `apply_package_ledger_entry()` trigger'ının aynası. Uç kuralları (izin, sürüm,
  idempotency, doğrulama) `MockPackagesService`'te kaldı.
- **`MockPackageReports`** — raporlar tabloların OKUNUR kopyası üzerinde; sunucuda da
  `modules/reporting` paket tablolarına yazmıyor.

Bölme sırasında bir başlatma sırası tuzağı yakalandı: `lastInstant` `init { seed() }`'den
sonra tanımlıydı ve Kotlin başlatıcıları metin sırasıyla koşar. Seed bugün `nextInstant`
çağırmıyor ama çağırsaydı alan başlatılmamış olurdu; yukarı taşındı ve yorumu yazıldı.

### Seed genişledi: süresi YAKLAŞAN iki paket

Süre dolumu raporu boş bir ekranla sınanamaz. Fatma (Nişantaşı) ve Selin (Bodrum) için
bir yıl önce satılmış, seed anından iki-üç hafta sonra dolan lazer paketleri eklendi;
şube kırılımı da ancak iki şubeyle görünüyor. Kalan hakları yine **defterden** doğuyor.

### Plandan / iOS'tan sapmalar

- **Süre dolumu satırı müşteri kartına GİTMİYOR** (iOS gidiyor). Rapor Yönetim
  sekmesinde, kart Müşteriler sekmesinde; sekmeler arası gezinme kabukta henüz yok ve
  Yönetim'e ikinci bir müşteri kartı grafiği kurmak, kartın bütün alt hedeflerini
  (not, dosya, paket işlemleri) orada da kaydetmek demekti. A7 hub'ında ele alınacak.
- **Üç rapor TEK ViewModel'i paylaşıyor** — sahibi rapor girişinin geri yığını kaydı
  (`navController.getBackStackEntry<PackageReportsHome>()`). iOS'taki "ortak filtre"
  kararının Android karşılığı; Yönetim'den çıkınca ViewModel de ölüyor.
- **Sayfalama sonsuz kaydırma değil, "Sonraki sayfa" düğmesi.** `KlinaraScreen`'in
  kaydırılabilir `Column`'u görünürlük tetikleyicisi vermiyor; `LazyColumn`'a geçmek
  ekran iskeletini yalnız bu rapor için değiştirmek olurdu.
- Yeni bileşen: `ReportPeriodBar` (tasarım sistemi, galeride) — tarih bilmiyor, yalnız
  yön bildiriyor; kapsayıcı etiketi çağıran kuruyor.

### Yeni bağımlılık: YOK

### Kapsam dışı

- **Rapor dışa aktarımı** (CSV/PDF) — sunucuda `report-export.controller.ts` var; A9'da
  diğer raporlarla birlikte.
- **Çok aylık pencere** — iOS `months` alanını taşıyor ama arayüzü yok; burada da tek ay.

### Faz A5 kapandı

Dört batch, 418 test (faz başında 345). Çıkış ölçütü — **kalan seans hiçbir akışta
negatife düşmüyor ve istemci sayacı sunucu defteriyle ayrışmıyor** — üç katmanda
korunuyor: istemci kalan hakkı hiçbir yerde hesaplamıyor ya da yerelde güncellemiyor
(her yazmadan sonra sunucudan taze); mock'ta kalan hak defter satırlarının toplamı ve
tek yazma noktası hakkı yazmadan önce kontrol ediyor; `assertLedgerMatches` satış,
bağlama, tamamlama, yeniden açma, düzeltme, iade ve devrin her birinden sonra "defter
toplamı == kalan hak ≥ 0" diyor. Kalan borç: randevu oluşturma formunda paket
seçimi (kabloda var, arayüzü yok) ve iade tahsilatı (A6.2).

---

## A7.1 — Hizmet kataloğu ✅

**Durum:** `./gradlew check` yeşil. **452 test** (A5.4 sonunda 418'di), 65 suite.
Faz A6 (finans) henüz yapılmadı; A7 onu beklemiyor — hiçbir A7 ekranı paraya yazmıyor.
Temiz debug derlemesi **29,5 sn** (§4 tetikleyicisi 90 sn): modül bölme gündemde değil.
Emülatörde `Çok şubeli` senaryosu, **Bodrum** şubesiyle sürüldü: Yönetim → Katalog kartı →
Hizmetler (kategori grupları, Bodrum'un lazer farkı 1.650,00 ₺ / 1 sa "Şubeye özel"),
lazer editöründe Bodrum süresi + → kaydet → liste sessizce "1 sa 5 dk · takvimde 1 sa
20 dk"; Kategoriler'de hizmeti olan "Enjeksiyon İşlemleri"ni pasife almak afişte
**sunucunun metnini** gösterdi ("Kullanımda olan hizmet kategorisi pasife alınamaz").

### Katalog servisi okuma yarısından tam CRUD'a — yeni uç YOK

A3.4'ün tek metodu (`services()`) sekiz metotla tamamlandı: kategoriler (liste/oluştur/
güncelle/pasife al) ve hizmetler (tekil/oluştur/güncelle/pasife al). İkisi de sunucuda
`DELETE` ama **kaydı silmez, pasife alır ve 200 ile kaydı döner** — `sendVoid` değil
`send`. Katalog uçlarında If-Match, sürüm, sayfalama yok; son yazan kazanır.

### PATCH alan TEMİZLEYEBİLİYOR — iOS'ta açıklama ve renk kaldırılamıyor

`UpdateServiceInput.description` ve `.calendarColor` `Patch<String>`. iOS her alanı
`String?` ile gönderiyor ve `nil` JSON'dan atıldığı için hizmetin rengini ya da
açıklamasını **silemiyor** — sunucu eskisini koruyor. `updateClearsWithExplicitNull`
açık `null`'u, `updateSendsOnlyChanges` rengi kaldırmanın `Patch.Clear` ürettiğini
çiviliyor. Form ayrıca yalnız DEĞİŞEN alanları gönderiyor (iOS hepsini).

### Şube farkları tam değiştirme; değişmediyse hiç gönderilmiyor

`branchOverrides` verilirse liste tamamen yazılıyor, `null` "dokunma", boş liste "hepsini
kaldır". Ekran yalnız fiyat ve süreyi düzenliyor (iOS gibi); sunucudan gelen tampon/KDV/
online/aktif override alanları formda **korunup aynen geri yazılıyor**. İki alan da
boşalan şube satırı listeden düşüyor: değer taşımayan satır sunucuda 400
(`overrideEditing`, `overrideListSemantics`). Farklar değişmediyse liste gövdeye girmiyor
— her kayıtta override kimliklerini boşuna yenilemek yok.

### `effective(branchId)` artık tüm override alanlarını çözüyor

A3.4'teki hâli yalnız süre/fiyat veriyordu ve `isActive == false` olan override'ı yok
sayıyordu. Şimdi tampon, online, aktiflik ve `isOverridden` da geliyor; override'da
`null` **miras** demek (`serviceDecodesWithOverride`). Liste satırları seçili şubenin
gerçeğini gösteriyor; pasif süzgeci de şubenin etkin aktifliğine bakıyor.

### Mock katalog yazılabilir bir tablo — randevu motoru onu okuyor

`MockCatalogService.ALL` artık yalnız **tohum**; çalışma verisi örnekte ve
`snapshotServices()` ile paylaşılıyor. `MockBookingService` statik `ALL` yerine enjekte
edilen `catalog` sağlayıcısını okuyor (`ServiceContainer.mock()` bağlıyor; testlerde
varsayılan tohum) — oturumda eklenen hizmetin süresi randevuya, adı takvim satırına
yansıyor. `MockBookingSeed`'in A3.1'den kalma özel katalog kopyası kaldırıldı; tohum
adları ve fiyatları katalog tohumundan türüyor. Mock sunucunun kurallarını taklit ediyor:
büyük/küçük harf duyarsız slug çakışması 409, bilinmeyen kategori 404, **aktif hizmeti
olan kategori pasife alınamaz** 409 (`MockCatalogServiceTest`). Kategoriler üçe bölündü
(Cilt Bakımı / Epilasyon / Enjeksiyon); A3.4'ün tek kategori kimliği korundu. Lazerin
Bodrum farkı tohumda: "Şubeye özel" rozeti ve şube farkları kartı ancak öyle sürülebilir.

### Kategori sıralaması iki PATCH — hata olursa sunucudan yeniden çekiliyor

Toplu sıralama ucu yok (Kural 1). Taşınan kategori komşunun `sortOrder`'ını, komşu da
onunkini alıyor. İkinci yazma düşerse iki kategori aynı sırayı taşır; ekran yerel bir
tahmin göstermiyor, **sunucunun gerçeğini** yeniden çekiyor (`moveFailureReloads`: sıra
`[1, 1, 2]`). Eşit sıralı eski veride takas indeksten kuruluyor.

### Yönetim hub'ı kendi dosyasında ve saf bir fonksiyon

`ManagementHomeScreen` `AppShell.kt`'deki private ara çözümden
`features/shell/ManagementHomeScreen.kt`'ye taşındı; kart kümesi
`managementSections(session)` (izin → kart). Kapı **kart** düzeyinde, iOS gibi: okuma
izni kartı açar, yazma izni ekranın içinde sorulur (salt okunur editör). Hedef → route
eşlemesi tek bir `when` — yeni satır eklenince derleyici soruyor. `ManagementSectionsTest`
altı rolü geziyor: `accountant` Katalog kartını görmüyor.

### Tasarım sistemine eklenenler

- `KlinaraStepperRow(step = …)` — süre ve tamponlar 5 dakikalık adımla (iOS `step: 5`);
  varsayılan 1, var olan çağıranlar değişmedi.
- `ColorSwatchPicker` paletin **dışındaki** kayıtlı rengi seçili bir "özel renk" örneği
  olarak gösteriyor. Web-admin'den ya da eski bir kayıttan gelen renk gösterilmezse hiçbir
  örnek seçili görünmez ve kullanıcı rengin "renksiz" olduğunu sanar.

### iOS'a bildirilecek fark (§7.8)

1. **PATCH temizleyemiyor** (yukarıda) — `ServiceForm.updateInput` ve iOS
   `StaffProfileDraft` aynı hatayı taşıyor.
2. **Pasife alma hataları yutuluyor** — `ServiceListView` ve `ServiceCategoryListView`
   `try?` kullanıyor; kullanımdaki kategori 409'u kullanıcıya hiç ulaşmıyor.
3. **Kategori kartındaki "Sıralamak için basılı tutup sürükleyin" dipnotu yanlış** —
   arayüzde sürükleme yok, yukarı/aşağı düğmesi var. Android'de o metin yazılmadı.

### Plandan / iOS'tan sapmalar

- **Oturum ömürlü `CatalogStore` yok** (A5.1 kararı): her ekran kendi ViewModel'ini
  alıyor, ortak okuma `CatalogService.snapshot()` (kategoriler + hizmetler paralel).
  Gruplama/süzme kuralı `CatalogSnapshot`'ta tek yerde.
- **Hizmet editörü sheet değil `NavHost` hedefi**; kategori editörü bir diyalog
  (`CustomerTagListScreen` deseni) — üç alanlık bir form için ayrı hedef fazla.
  Diyalog açıkken sunucu hatası diyalogun **içinde** gösteriliyor, arkadaki afişte değil.
- **Pasife alma kaydırma jesti değil kartta düğme** (A5.1 gerekçesi).
- **Kategori seçici menü değil, seçilebilir satırlar** — kiracı başına bir avuç kategori;
  seçili pasif kategori listede kalıyor, yoksa düzenlenen hizmetin kategorisi boş görünürdü.
- KDV seçici listede olmayan oranı (%1 gibi) ek bir parça olarak gösteriyor; iOS'ta öyle
  bir değerde hiçbir parça seçili görünmüyor.

### Yeni bağımlılık: YOK

### Kapsam dışı

- **Hizmet silme / arşiv** — sunucuda yok; pasife alma tek yol.
- **Override'ın tampon, KDV, online ve aktiflik alanları** için arayüz (iOS'ta da yok);
  değerleri korunuyor.
- **`holidays` uçları** — iOS kullanmıyor; A7.3'te de kapsam dışı (parite).

---

## A7.2 — Personel ✅

**Durum:** `./gradlew check` yeşil. **470 test** (A7.1 sonunda 452'ydi), 67 suite.
Emülatörde `Çok şubeli` senaryosu, Nişantaşı ile sürüldü: Yönetim → Ekip → Personel (renk
noktası, "3 hizmet", Online rozetleri) → Yeni personel → aday listesinde yalnız
**profilsiz** iki kullanıcı (Ayşe Yılmaz, Elif Kaya) → Elif + unvan → Oluştur → ekran
**detaya** geçti → Yetkinlikler → Lazer açıldı (kapsam seçici: Tüm şubeler / Nişantaşı /
Bodrum) → Kaydet → "Yetkinlikler kaydedildi." → listede Elif "1 hizmet".

### Personel servisi tam — silme yok, `users` geldi

`StaffService` dört metot kazandı (`profile`, `create`, `update`, `replaceSkills`);
`UsersService` (`GET users`, `user:read`) yeni ve tek çağıranı oluşturma ekranı — iOS
paritesi. Profil var olan bir kullanıcıya bağlanıyor; davet akışı bu istemcide yok (iOS'ta
da yok), aday kalmadığında ekran davet yolunu anlatıyor. Pasife almak `PATCH isActive`.

### Yetkinlik matrisi KAYIPSIZ — iOS'ta bir hizmetin ikinci şube kapsamı siliniyor

`PUT staff/:id/services` listeyi tamamen değiştiriyor. iOS taslağı `serviceId` ile
anahtarlıyor: aynı hizmette iki şube kapsamı olan personelde biri, ayrıca pasif yetkinlik
satırları ve ekranı olmayan `customPriceMinor` kayıtta **sessizce** gidiyor.
`SkillMatrixDraft` hizmet başına bir satırı düzenliyor, gösterilmeyenleri `preserved`'da
aynen geri yazıyor (`matrixIsLossless`: iOS'un 1 yazacağı yerde 3). Kullanıcı bir satırın
kapsamını korunan bir satırınkiyle aynı yaparsa korunan düşüyor — aynı çift sunucuda 400
(`scopeCollisionDedupes`). Satırda "+N şube kapsamı daha" yazıyor.

### Pasif hizmetin yetkinliği geri YAZILAMAZ — ekran bunu söylüyor

Sunucu pasif hizmete yetkinliği `K0002` → 409 ile reddediyor ve PUT tüm satırları yeniden
ekliyor; yani pasif hizmetteki eski bir yetkinlik bir sonraki kayıtta ya düşmeli ya da
kaydı bozmalı. Taslak onları `dropped`'a ayırıyor ve matris kırmızı bir satırla "Pasif
hizmetlerdeki N yetkinlik bir sonraki kayıtta kaldırılır" diyor. iOS aynı durumda
kaydedilemeyen bir 409 alıyor.

### PATCH unvan, tanıtım, renk ve birincil şubeyi TEMİZLEYEBİLİYOR

`UpdateStaffProfileInput` dört alanı `Patch<String>` ile taşıyor; `StaffProfileDraft` yalnız
değişeni gönderiyor. iOS boş unvanı `nil` yapıp gövdeden atıyor ve sunucu eskisini
koruyor (§7.8, A7.1'deki hatanın ikizi).

### Oluşturma iki izin ister: `staff:write` + `user:read`

Aday listesi `GET users`'tan geliyor. Yalnız `staff:write`'a sahip bir rol düğmeyi görüp
içeride 403 alırdı. Bugün iki izin aynı rollerde (owner, manager) ama koşul "şans eseri
doğru" olmamalı — `canCreateStaff` saf fonksiyon, altı rol `StaffFeatureTest.permissions`'ta.

### Mock personel yazılabilir tablo, randevu motoru onu okuyor

`MockStaffService` A7.1'deki katalog kalıbıyla: tohum `ALL`, çalışma verisi örnekte,
`snapshotProfiles()` ile paylaşılıyor; `MockBookingService` adayları enjekte edilen
`staff` sağlayıcısından alıyor (`bookingSeesSkillChanges`: Merve'nin lazer yetkinliği
kalkınca o günün slotları boşalıyor). Sunucu kuralları: aynı kullanıcıya ikinci profil 409,
bilinmeyen kullanıcı/hizmet 404, pasif hizmet 409, aynı (hizmet, şube) çifti 400.
**Tohum düzeltmesi:** A3.1'de üç profil de `USER_MANAGER`'a bağlıydı — sunucunun bir
kullanıcıya tek profil kuralını çiğniyordu. Her profile kendi kullanıcısı verildi; oturumdaki
yönetici ve resepsiyon profilsiz kaldı ki aday listesi boş olmasın.

### Tasarım sistemine eklenenler

`KlinaraTagField` (galeride) — "Bitti" ile ekler, kırpar, büyük/küçük harf duyarsız tekil;
etikete dokunmak kaldırır ve TalkBack'e "… kaldır" diye duyuruluyor (iOS'ta ipucu yok).

### iOS'a bildirilecek fark (§7.8)

1. **Matris kaydı veri siliyor** — ikinci şube kapsamı, pasif yetkinlik satırları ve
   `customPriceMinor` (yukarıda).
2. **Profil PATCH'i temizleyemiyor** — unvan, tanıtım, renk, birincil şube.
3. **Pasif hizmetteki eski yetkinlik** matrisi kaydedilemez hâle getiriyor (409).

### Plandan / iOS'tan sapmalar

- **Oluşturma sheet değil hedef; oluşunca DETAYA geçiliyor**, geri yığınından çıkarak
  (`popUpTo<StaffCreate> { inclusive = true }`). iOS listeye dönüyor; profilin bir sonraki
  adımı yetkinlik ve giriş noktası detayda. Geri tuşu dolu bir forma dönmüyor (ikinci
  dokunuş 409 alırdı).
- **Detay ve matriste "Kaydet" üst çubukta değil sayfa sonunda** (A5 deseni).
- Detaydan matrise gidip dönmek taslağı **ezmiyor**: kirli taslak korunuyor, yalnız profil
  tazeleniyor (`detailSaveAndReload`).
- Birincil şube seçici oturumun erişemediği bir şubeyi "Erişiminiz olmayan bir şube" diye
  seçili gösteriyor; iOS'ta öyle bir kayıtta hiçbir satır seçili görünmüyor.
- Program ve istisna satırları A7.2'de **çizilmedi** (sahte satır yok); A7.3'te bağlanıyor.

### Yeni bağımlılık: YOK

### Kapsam dışı

- **Davet** (`POST invitations`) ve kullanıcı/üyelik düzenleme — iOS'ta da yok.
- Yetkinlikte **özel fiyat** arayüzü — iOS'ta da yok; değer korunuyor.

---

## A7.3 — Çalışma saatleri ✅

**Durum:** `./gradlew check` yeşil. **497 test** (A7.2 sonunda 470'ti), 69 suite.
Emülatörde `Çok şubeli` senaryosu, Nişantaşı ile sürüldü: Yönetim → Takvim kurulumu →
Şube çalışma saatleri → Pazartesi kapanışı 08:00 yapıldı → kart altında **"Kapanış
açılıştan sonra olmalı."**, Kaydet pasif, şube menüsü gizli; sistem geri tuşu
"Değişiklikler kaydedilmedi" diyaloğunu açtı → 18:00'e düzeltilip Cumartesi **kapatıldı**
ve kaydedildi → Bugün → Yeni randevu → Cilt bakımı: Cuma 11 Eylül'de slotlar 12:15–13:45
**mola** aralığını atlıyor; Cumartesi 12 Eylül'de "Bu günde uygun saat yok". İzin ve
istisnalar: tohumdaki iki kayıt ("Cmt · Her hafta", "Yıllık izin") → Yeni istisna → Onur,
Haftalık, Per → Oluştur → listede "Per · Her hafta". Paket raporları → Süre dolumu →
Fatma Şahin satırı → **Müşteriler sekmesi** müşteri kartıyla açıldı. Personel programı
koyu temada kontrol edildi.

### Scheduling servisi — yedi uç, yeni uç YOK

`SchedulingService` (+`Live*`/`Mock*`): şube saatleri GET/PUT, personel programı GET/PUT,
istisnalar GET/POST/DELETE (204, `sendVoid`). Hepsi `X-Branch-Id` ister; şube seçili değilse
ekran çağırmıyor, iOS'un "Şube seçilmedi" metnini gösteriyor. PUT'lar tam 7 gün. Saat biçimi
asimetrik: gönderim `HH:mm`, dönüş `HH:mm:ss` — yanıt `String?` tutulup `ClockTime.parse` ile
okunuyor (`branchHoursDecode`, `bodies`). `holidays` uçları iOS'ta yok, burada da yok.

### Sıralama kuralları İSTEMCİDE — sunucunun yanıltıcı 409'una düşülmüyor

Sunucu açılış < kapanış, mola içeride ve başlangıç < bitiş kurallarını yalnız DB CHECK'te
tutuyor; ihlal "Şube bu kiracıya ait değil" başlıklı bir 409 dönüyor. iOS doğrulamadığı için
kullanıcı o metni görüyor. `WeekHoursDraft`/`StaffWeekDraft` gün başına hata taşıyor ve
geçersiz hafta **gönderilmiyor** (`invalidWeekNotSent`: sayaç 0). Mock bu 409'u sunucunun
başlığıyla taklit ediyor (`mockValidations`). `API_DEVELOPMENT.md` Faz 2 açık maddelerine
yazıldı.

### İstisna listesi `from` göndermiyor — iOS'ta süren istisnalar görünmüyor

Sunucu `from`/`to`'yu yalnız `startsAt` ile karşılaştırıyor. iOS `from = bugün` gönderiyor:
geçen hafta başlamış süren bir izin ya da haftalık bir tekrar listede hiç yok. Android yalnız
`to` gönderip "hâlâ geçerli olanları" (`endsAt ≥ bugün` ya da haftalıkta `recurrenceUntil ≥
bugün`) istemcide süzüyor (`stillRelevant`). Mock sunucunun kusurlu süzgecini **aynen**
taklit ediyor — daha doğru bir mock canlıda görünmeyen bir satırı gösterirdi
(`mockExceptions`). Açık soru olarak `API_DEVELOPMENT.md`'ye yazıldı.

### Zaman şubenin duvar saatinde; kablo şube offset'iyle

`ScheduleExceptionDraft` `LocalDate` + `ClockTime` tutuyor ve `BranchClock` ile offset'li
ISO'ya çeviriyor. `wireUsesBranchOffset`: İstanbul `+03:00`; Berlin'de aynı 09:00 Eylül'de
`+02:00`, Kasım'da `+01:00` — duvar saati korunuyor. Tekrarın son günü **23:59'a kadar**
(iOS tarih seçicinin taşıdığı rastgele saati gönderiyor; o günün öğleden sonraki örneği
düşebiliyor). `none`'da tekrar alanları gövdeye hiç girmiyor (sunucu 400). Başlangıç
değişince bitiş/tekrar bitişi iOS kuralıyla itiliyor (`pushRules`, gece yarısını geçen itme
ertesi güne).

### Mock randevu motoru çalışma saatlerine TAM bağlı (kullanıcı kararı)

`MockBookingService.availability` artık sabit 09:00–18:00 yerine **şube saatleri ∩ personel
programı − mola − istisnalar** içinde slot üretiyor (`MockSchedulingService.workingIntervals`,
sunucunun `availability.repository.ts` kuralı). Haftalık istisna şube yerel tarihinde
açılıyor, `startsAt`'in yerel saatini koruyor ve aralık ilk örneğin ISO haftasından sayılıyor
(`biweekly`). Programı olmayan personel slot üretmiyor (sunucu gibi). Tohum: iki şube
Pzt–Cmt 09:00–19:00, 13–14 mola, Pazar kapalı; Merve Çarşamba izinli; Onur Bodrum'da yalnız
Cumartesi; Merve'ye yarının gününde haftalık "Eğitim". **Takvim bağlanmamış motor** (birim
testleri) eski sabit pencereyi koruyor: tohumlu testler haftanın gününe bağımlı olmasın
(`fallbackWindow`) — var olan hiçbir beklenti değişmedi.

### Kaydedilmemiş hafta korunuyor — iOS sheet'inin Android karşılığı

Hafta ekranları kirliyken şube menüsü gizleniyor (iOS gibi) ve hem sistem geri tuşu hem üst
çubuk oku "Değişiklikler kaydedilmedi" diyaloğunu açıyor (`rememberUnsavedChangesGuard`).
ViewModel anahtarı şubeyi taşıyor: şube değişince yeni taslak, eskisi başka şubeye
kaydedilemez. Programı hiç olmayan personelde ekran kırmızı bir satırla "randevu açılamaz"
diyor ve varsayılan saatler kirli olmasa da kaydedilebiliyor (`staffWithoutRecordCanSave`).

### Yakalanan gerçek hata: "Pazartesi" ve "Pazar" ikisi de "Paz"

iOS `Weekday.shortName` ilk üç harfi alıyor; haftalık tekrar rozeti Pazartesi ile Pazar'ı
ayırt edemiyor. `recurrenceText` testi yakaladı; kısaltmalar standart Türkçe (Pzt, Sal, Çar,
Per, Cum, Cmt, Paz) ve tekillikleri testli. `dow` artık bildirim sırasından (`ordinal`) —
Pazar ilk; sabit sayı yok.

### Sekmeler arası gezinme (A5.4'ten bırakılmıştı)

Süre dolumu raporunun satırı müşteri kartını açıyor (iOS gibi). Hedef sekmenin `NavHost`'u
hiç çizilmemiş olabilir (grafiği yok, `navigate` çöker) — istek `pendingCustomerId` olarak
bekletiliyor, sekme çizilince bir kez tüketiliyor. `customer:read` yoksa satır tıklanmıyor.

### Tasarım sistemine eklenenler

- `KlinaraTimeField` (M3 `TimePicker`, 24 saat) ve `KlinaraDateField` (M3 `DatePicker`) —
  ikisi de `java.time` konuşuyor, `services/`'e bağımlı değil. `DatePicker` UTC-milisaniye
  verdiği için çeviri tek yerde (`DatePickerMillis`, testli). M3'ün seçili olmayan saat
  kutusunu boyadığı **mor** ton marka token'larıyla değiştirildi (emülatörde görüldü).
- `BranchClock` üç yardımcı kazandı: `instant(date, time)`, `localDate`, `clockTime`, ve
  iki uçlu aralık için `formatSpan`.

### iOS'a bildirilecek fark (§7.8)

1. **Gün kısaltmaları çakışıyor** (Paz/Paz).
2. **Çalışma saatlerinde istemci doğrulaması yok** — kullanıcı sunucunun alakasız 409'unu görüyor.
3. **İstisna listesi süren kayıtları göstermiyor** (`from` kusuru).
4. **Tekrar bitişi günün rastgele saatinde** gönderiliyor.

### Plandan / iOS'tan sapmalar

- **`KlinaraDateTimeField` yerine iki alan** (`KlinaraDateField` + `KlinaraTimeField`): M3'te
  birleşik bir seçici yok; iki diyaloğu tek bileşene sarmak yalnız bir sarmalayıcı olurdu.
- İstisna editörü bir hedef, sheet değil; "yeni" formu iOS gibi her zaman "kirli" sayılıyor.
- Personel detayındaki program/istisna satırları `schedule:read` ile çiziliyor; istisna
  listesi personelden açılınca editör o personeli ön seçiyor.
- Hafta ekranlarında "Kaydet" sayfa sonunda (A5 deseni).

### Kararsız test (A7 dokunmadı)

`ApiClientTest` › "Eş zamanlı üç 401 TEK bir /auth/refresh tetikler" tam `check` sırasında
bir kez düştü; izole üç koşuda geçti. Yük altında zamanlamaya bağlı; ayrı bir iş olarak
işaretlendi.

### Yeni bağımlılık: YOK

### Kapsam dışı

- **Tatiller** (`holidays` CRUD) — iOS kullanmıyor.
- **İstisna düzenleme** — sunucuda PATCH yok; sil + yeniden oluştur taklit edilmiyor.
- Randevu **oluşturmada** çalışma saati kontrolü mock'ta yok (yalnız uygunluk); sunucu
  `OUTSIDE_WORKING_HOURS` döndürüyor ve metni zaten `ApiError` tablosunda.

### Faz A7 kapandı

Üç batch, 497 test (faz başında 418). Çıkış ölçütü — **`ManagementHomeScreen` tüm bölümleri
izne göre listeliyor; kurulum akışı uçtan uca sürülebiliyor** — iki katmanda korunuyor: hub
saf bir fonksiyon (`managementSections`) ve altı rolün matrisi üç testte
(`ManagementSectionsTest`, `StaffFeatureTest.permissions`, `SchedulingFeatureTest.permissions`);
mock randevu motoru katalog, personel ve çalışma saatleri **tablolarını** okuyor, yani
"hizmet ekle → yetkinlik ver → program yaz → istisna gir → slot gör" zinciri emülatörde
sunucusuz sürülebiliyor. Temiz derleme 29,5 sn — §4'ün modül bölme tetikleyicisi (90 sn)
uzakta. Kalan borç: iOS'a dört + üç + üç fark notu (§7.8) ve iki sunucu açık sorusu.
