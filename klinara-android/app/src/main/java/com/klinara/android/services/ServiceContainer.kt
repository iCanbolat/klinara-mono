package com.klinara.android.services

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import com.klinara.android.services.auth.AuthService
import com.klinara.android.services.auth.LiveAuthService
import com.klinara.android.services.auth.MockAuthService
import com.klinara.android.services.auth.KeystoreSessionCipher
import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.booking.LiveBookingService
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.LiveCatalogService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.crm.LiveCustomerService
import com.klinara.android.services.crm.LiveNotesService
import com.klinara.android.services.crm.MockCustomerService
import com.klinara.android.services.crm.MockNotesService
import com.klinara.android.services.crm.NotesService
import com.klinara.android.services.files.FilesService
import com.klinara.android.services.files.LiveFilesService
import com.klinara.android.services.files.MockFilesService
import com.klinara.android.services.files.ThumbnailCache
import okhttp3.OkHttpClient
import com.klinara.android.services.notifications.LiveNotificationsService
import com.klinara.android.services.notifications.MockNotificationsService
import com.klinara.android.services.notifications.NotificationsService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockScenario
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiEnvironment
import com.klinara.android.services.networking.OkHttpFactory
import com.klinara.android.services.networking.SignedUploader
import com.klinara.android.services.staff.LiveStaffService
import com.klinara.android.services.staff.MockStaffService
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * Bağımlılık kökü.
 *
 * **"Mock mu canlı mı" sorusu YALNIZ burada cevaplanır**; ekranlar arayüzlere konuşur
 * (§5.1). Hilt yok: iOS'ta tek karar noktası bir sınıf ve aynısı burada da yeterli.
 * Bir annotation processor, bir derleme yavaşlaması ve "bu ekran hangi uygulamayı
 * alıyor" sorusunu grafiğe dağıtan bir dolaylılık kazandırmazdı.
 *
 * `Application` seviyesinde tutulur ve `MainActivity` yeniden yaratılınca (döndürme,
 * tema değişimi) YENİDEN KURULMAZ — aksi hâlde oturum içi mock durumu ekran döndürmede
 * sıfırlanır.
 *
 * Sonraki fazlarda eklenecek servisler — her biri KENDİ batch'inde, boş arayüz olarak
 * DEĞİL (boş arayüzler okunmamış uçlar için imza tahmini kodlar ve her batch'te
 * "refactor" edilir; ilerleme gibi görünen çalkantı):
 *
 *     customers A3.4 · notifications(opt-out) A4.2 · notes A4.3 ✓ · files A4.4 ✓ · files A4.4 · packages A5.1
 *     finance A6.1 · commissions A6.4 · scheduling A7.3
 *     notifications A8.1 · messages A8.1 · whatsapp A8.3 · reports A9
 *
 * **A3.1'de iki servis planlanandan ÖNCE geldi** ve `ANDROID_DEVELOPMENT.md` §6 buna
 * göre güncellendi: `booking` A3.4 yerine A3.1'de (takvim onsuz çizilemez; oluşturma
 * metotları yine A3.4'te ekleniyor) ve `staff` A7.2 yerine A3.1'de (personel adı ve
 * `calendarColor` olmadan ne filtre çipi ne blok aksanı çizilebilir). İkisi de gerçek
 * metot + gerçek çağıran + kendi mock'u ile geldi; boş arayüz kuralı çiğnenmedi.
 *
 * `users` A7.2'de gelir, A2.1'de DEĞİL: iOS'ta `UsersService`'in tek çağıranı
 * `StaffCreateView` (personel davet edilecek kullanıcıyı seçiyor). Kabuk ve profil
 * `AuthService.me()` + `.branches()` ile yetiniyor.
 */
@Suppress("LongParameterList")
// Bağımlılık kökünde uzun parametre listesi bir koku DEĞİL, tanımın kendisi: her servis
// burada tam olarak bir kez adlandırılıyor ve A9'a kadar on dört tane daha gelecek.
// Alternatif, servisleri bir `Services` taşıyıcısına sarmaktı — o da `container.booking`
// yerine `container.services.booking` yazdırır ve okunurluğu artırmadan bir dolaylılık
// katmanı eklerdi. Kural burada bilerek gevşetildi (§7.7).
class ServiceContainer private constructor(
    val auth: AuthService,
    val booking: BookingService,
    val staff: StaffService,
    val customers: CustomerService,
    val notifications: NotificationsService,
    val notes: NotesService,
    val files: FilesService,
    val thumbnails: ThumbnailCache,
    val catalog: CatalogService,
    val tokens: TokenStore,
    val sessionExpired: SharedFlow<Unit>,
    /** Yalnız mock modda dolu — geliştirici senaryo menüsü bunu kullanır. */
    val mockAuth: MockAuthService?,
    val uploader: SignedUploader?,
    /** Yalnız mock modda dolu. */
    val mockDataScenario: MockDataScenario?,
) {
    val isMock: Boolean get() = mockAuth != null

    companion object {
        /**
         * Canlı grafiği kurar. TEK bir `ApiClient` bütün servislere verilir; ikinci bir
         * istemci ikinci bir token yenileme kuyruğu demek olurdu.
         */
        fun live(
            dataStore: DataStore<Preferences>,
            scope: CoroutineScope,
        ): ServiceContainer {
            val tokens = TokenStore(dataStore, KeystoreSessionCipher())

            // Sona erme sinyalini ApiClient üretiyor; SessionRefresher'ın onExpired'ı
            // aynı akışa bağlanıyor ki "yenileme de başarısız" tek bir olay olsun.
            val expired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

            val clients =
                OkHttpFactory.create(
                    tokens = tokens,
                    scope = scope,
                    onExpired = { expired.tryEmit(Unit) },
                )

            val client = ApiClient(clients.api, ApiEnvironment.baseUrl)
            val liveFiles = LiveFilesService(client)

            // Şube saat dilimi oturum açılana kadar bilinmiyor; `BranchClock`'un
            // varsayılanı zaten Europe/Istanbul ve burada YALNIZ `/appointments`
            // sorgusunun kablo biçimi için kullanılıyor (offset'li ISO). Ekranlar
            // kendi saatlerini `session.activeBranch.timezone` ile kuruyor.
            return ServiceContainer(
                auth = LiveAuthService(client),
                booking = LiveBookingService(client, BranchClock(null)),
                staff = LiveStaffService(client),
                customers = LiveCustomerService(client),
                notifications = LiveNotificationsService(client),
                notes = LiveNotesService(client),
                files = liveFiles,
                // Küçük görsel indirmesi imzalı URL'ye gidiyor: `bare` istemci, yani
                // `Authorization` ve `X-Branch-Id` GÖNDERİLMİYOR (§5.4).
                thumbnails = ThumbnailCache(liveFiles, clients.bare),
                catalog = LiveCatalogService(client),
                tokens = tokens,
                sessionExpired = client.sessionExpired,
                mockAuth = null,
                uploader = SignedUploader(clients.bare),
                mockDataScenario = null,
            )
        }

        /**
         * Mock grafiği. Mock'lar kurucu üzerinden **birbirine bağlanır**; ayrı
         * tohumlanmış kopyalar birbirini tanımayan kimliklerle çalışır ve mock veri
         * sessizce tutarsızlaşır (iOS'ta bir kez yaşandı).
         *
         * A3.1'de grafik üç düğüm: `auth`, `booking`, `staff`. Randevu tohumu ile
         * personel listesi [com.klinara.android.services.mock.MockIds] üzerinden aynı
         * kimliklere bakar; ayrı tohumlanmış kopyalar var olmayan bir personele bağlı
         * randevu üretirdi.
         *
         * `NetworkError` senaryosu artık takvimi ve personeli de düşürüyor: giriş
         * yolunu ağ hatasına ayarlayıp oturum içinde her şeyin çalıştığını görmek,
         * senaryonun yarısını yalan söyler hâle getirirdi.
         */
        fun mock(
            dataStore: DataStore<Preferences>,
            scenario: MockScenario = MockScenario.PasswordThenTotp,
            data: MockDataScenario = MockDataScenario.BusyDay,
        ): ServiceContainer {
            val tokens = TokenStore(dataStore, KeystoreSessionCipher())
            val mockAuth = MockAuthService(scenario)
            val failing = scenario == MockScenario.NetworkError
            val mockBooking = MockBookingService(data).apply { this.failing = failing }
            val mockStaff = MockStaffService().apply { this.failing = failing }
            val mockCustomers = MockCustomerService().apply { this.failing = failing }
            val mockNotifications = MockNotificationsService().apply { this.failing = failing }
            val mockNotes = MockNotesService().apply { this.failing = failing }
            val mockFiles = MockFilesService().apply { this.failing = failing }
            val mockCatalog = MockCatalogService().apply { this.failing = failing }

            return ServiceContainer(
                auth = mockAuth,
                booking = mockBooking,
                staff = mockStaff,
                customers = mockCustomers,
                notifications = mockNotifications,
                notes = mockNotes,
                files = mockFiles,
                thumbnails = ThumbnailCache(mockFiles, OkHttpClient()),
                catalog = mockCatalog,
                tokens = tokens,
                sessionExpired = MutableSharedFlow(extraBufferCapacity = 1),
                mockAuth = mockAuth,
                uploader = null,
                mockDataScenario = data,
            )
        }

        /**
         * Birim testleri için: hazır bileşenleri doğrudan alır.
         *
         * `internal` — testler aynı modülde. Alternatifi her testin bir DataStore ve bir
         * Keystore kurması olurdu ki ikincisi JVM'de zaten yok.
         */
        @Suppress("LongParameterList")
        internal fun testing(
            auth: AuthService,
            tokens: TokenStore,
            sessionExpired: SharedFlow<Unit>,
            mockAuth: MockAuthService? = null,
            booking: BookingService = MockBookingService(latencyEnabled = false),
            staff: StaffService = MockStaffService(latencyEnabled = false),
            customers: CustomerService = MockCustomerService(latencyEnabled = false),
        notifications: NotificationsService = MockNotificationsService(latencyEnabled = false),
        notes: NotesService = MockNotesService(latencyEnabled = false),
        files: FilesService = MockFilesService(latencyEnabled = false, thumbnailDelayMillis = 0),
            catalog: CatalogService = MockCatalogService(latencyEnabled = false),
        ) = ServiceContainer(
            auth = auth,
            booking = booking,
            staff = staff,
            customers = customers,
            notifications = notifications,
            notes = notes,
            files = files,
            thumbnails = ThumbnailCache(files, OkHttpClient()),
            catalog = catalog,
            tokens = tokens,
            sessionExpired = sessionExpired,
            mockAuth = mockAuth,
            uploader = null,
            mockDataScenario = null,
        )

        private const val SESSION_STORE = "klinara_session"

        /**
         * Oturum deposu Application ömrüne aittir, container'a DEĞİL.
         *
         * DataStore aynı dosya için ikinci bir örneğe izin vermez ve çöker; canlı ↔ mock
         * geçişi her seferinde yeni bir container kurduğu için depo dışarıda tutulup
         * paylaşılmak zorunda.
         */
        fun sessionDataStore(
            context: Context,
            scope: CoroutineScope,
        ): DataStore<Preferences> =
            PreferenceDataStoreFactory.create(scope = scope) {
                context.applicationContext.preferencesDataStoreFile(SESSION_STORE)
            }
    }
}
