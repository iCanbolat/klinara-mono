package com.klinara.android

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockScenario
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Uygulama kökü.
 *
 * [container] burada kurulur ve `MainActivity` yeniden yaratılınca (döndürme, tema
 * değişimi) YENİDEN KURULMAZ (§5.1).
 *
 * [appScope] token yenilemenin sahibidir: yenileme ilk gelen çağıranın kapsamında
 * koşsaydı, o çağıranın iptali (ekran kapandı) herkesin yenilemesini iptal ederdi.
 */
class KlinaraApplication : Application() {
    val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Container'lar arasında PAYLAŞILIR — bkz. ServiceContainer.sessionDataStore. */
    private val sessionDataStore by lazy { ServiceContainer.sessionDataStore(this, appScope) }

    /**
     * `mutableStateOf` YALNIZ debug senaryo değişimi tüm ağacı recompose etsin diye;
     * release'te tam bir kez yazılır.
     *
     * Nullable backing alan bilinçli: bir "yer tutucu" container kurmak İKİNCİ bir
     * DataStore örneği doğururdu ve DataStore aynı dosya için iki örneğe izin vermez —
     * `onCreate` anında çöken bir uygulama. Container yalnız [onCreate]'te kurulur.
     */
    private var backing: ServiceContainer? by mutableStateOf(null)

    val container: ServiceContainer
        get() = requireNotNull(backing) { "ServiceContainer henüz kurulmadı — onCreate beklenmeli." }

    override fun onCreate() {
        super.onCreate()
        backing = ServiceContainer.live(sessionDataStore, appScope)
        // İnterceptor bloklayıcı okuduğu için cache bir kez ısıtılır; soğuk kalırsa
        // ilk istek Authorization'sız gider ve 401'e düşer (test edilmiş düşüş yolu).
        appScope.launch { container.tokens.warmUp() }
    }

    /** Yalnız debug: geliştirici senaryo menüsü (A1.1). */
    fun switchToMock(
        scenario: MockScenario,
        data: MockDataScenario,
    ) {
        backing = ServiceContainer.mock(sessionDataStore, scenario, data)
    }

    /** Yalnız debug: canlı grafiğe dönüş. */
    fun switchToLive() {
        backing = ServiceContainer.live(sessionDataStore, appScope)
        appScope.launch { container.tokens.warmUp() }
    }
}
