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
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockScenario
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiEnvironment
import com.klinara.android.services.networking.OkHttpFactory
import com.klinara.android.services.networking.SignedUploader
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
 *     booking A3.4 · customers A4.1 · notes A4.3 · files A4.4
 *     packages A5.1 · finance A6.1 · commissions A6.4 · catalog A7.1 · staff A7.2
 *     scheduling A7.3 · notifications A8.1 · messages A8.1 · whatsapp A8.3 · reports A9
 *
 * `users` A7.2'de gelir, A2.1'de DEĞİL: iOS'ta `UsersService`'in tek çağıranı
 * `StaffCreateView` (personel davet edilecek kullanıcıyı seçiyor). Kabuk ve profil
 * `AuthService.me()` + `.branches()` ile yetiniyor.
 */
class ServiceContainer private constructor(
    val auth: AuthService,
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

            return ServiceContainer(
                auth = LiveAuthService(client),
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
         * A0.5'te grafikte tek düğüm var: `AuthService`. Kanıtlanması gereken ŞEKİL —
         * live/mock çifti, Application ömrü, fixture okuyucu — bir servisle kanıtlanır.
         */
        fun mock(
            dataStore: DataStore<Preferences>,
            scenario: MockScenario = MockScenario.PasswordThenTotp,
            data: MockDataScenario = MockDataScenario.BusyDay,
        ): ServiceContainer {
            val tokens = TokenStore(dataStore, KeystoreSessionCipher())
            val mockAuth = MockAuthService(scenario)

            return ServiceContainer(
                auth = mockAuth,
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
        internal fun testing(
            auth: AuthService,
            tokens: TokenStore,
            sessionExpired: SharedFlow<Unit>,
            mockAuth: MockAuthService? = null,
        ) = ServiceContainer(
            auth = auth,
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
