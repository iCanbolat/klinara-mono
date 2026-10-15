package com.klinara.android.features.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.AuthService
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.branches.BranchesService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.realtime.RealtimeClient
import com.klinara.android.services.realtime.RealtimeEvent
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Oturum kapsamlı tek gerçek kaynak — iOS `AppSession` paritesi.
 *
 * **`AuthFlowViewModel`'den ayrı olması bilinçli.** O, girişin NASIL yapıldığını bilir
 * (challenge token, geri adımı, MFA); kabuğun ihtiyacı olan şey farklıdır: kim olduğum,
 * ne yapabildiğim, hangi şubede çalıştığım. İkisini tek modelde toplamak giriş akışının
 * durumunu uygulamanın geri kalanına sızdırırdı (§6 Faz A2 kararı).
 *
 * [AppSession] **immutable data class kalır** ve `AuthStep.Authenticated`'in payload'ı
 * olmayı sürdürür; burası onu `copy()` ile yeniler. İkinci bir mutable model sınıfı
 * eklenmedi.
 *
 * `SavedStateHandle` YOK: süreç ölümünde `TokenStore` (disk, şifreli) tek otoritedir ve
 * `AuthEvent.Start` oturumu zaten yeniden çözer. Profil ve izinleri `SavedStateHandle`'a
 * yazmak, sağlık verisi olmasa bile bayat bir izin kümesiyle uyanmak demekti.
 */
class SessionViewModel(
    initial: AppSession,
    private val auth: AuthService,
    private val tokens: TokenStore,
    private val branches: BranchesService,
    private val realtime: RealtimeClient? = null,
) : ViewModel() {
    private val _session = MutableStateFlow(initial)
    val session: StateFlow<AppSession> = _session.asStateFlow()

    /**
     * Şube değişince artan sayaç.
     *
     * Şube kapsamlı ekranlar buna `LaunchedEffect(generation)` ile bağlanır ve veriyi
     * yeniden çeker. iOS `branchGeneration` paritesi; A3'ten itibaren gerçek
     * tüketicileri olacak.
     */
    private val _branchGeneration = MutableStateFlow(0)
    val branchGeneration: StateFlow<Int> = _branchGeneration.asStateFlow()

    /**
     * Takvimi ilgilendiren anlık sinyaller — yalnız AKTİF şubeninkiler.
     *
     * Hangi günün ekranda açık olduğunu takvim ekranı biliyor; süzgecin ikinci yarısı
     * orada (`CalendarViewModel.onRealtime`). [RealtimeEvent.Resync] her zaman geçer.
     */
    private val _calendarEvents = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 16)
    val calendarEvents: SharedFlow<RealtimeEvent> = _calendarEvents.asSharedFlow()

    init {
        realtime?.let { client ->
            viewModelScope.launch {
                client.events.collect { event ->
                    when (event) {
                        is RealtimeEvent.CalendarChanged ->
                            if (event.branchId == _session.value.activeBranchId) _calendarEvents.tryEmit(event)
                        RealtimeEvent.Resync -> _calendarEvents.tryEmit(event)
                        // Mobilde zil akışı yok; personel bildirimi push ile geliyor.
                        is RealtimeEvent.StaffNotification -> Unit
                    }
                }
            }
        }
    }

    /**
     * Uygulama öne geldi. Arka plandayken soket kapalıydı ve o arada olan biten
     * bilinmiyor: [refresh] ise takvime bir kez "baştan oku" denir. İlk açılışta
     * gereksiz — ekran zaten ilk yüklemesini yapıyor.
     */
    fun becameActive(refresh: Boolean) {
        realtime?.start()
        if (refresh) _calendarEvents.tryEmit(RealtimeEvent.Resync)
    }

    /** Arka plan ve çıkış: soket arka planda tutulmaz (pil, ve sistem zaten keser). */
    fun resignedActive() {
        realtime?.stop()
    }

    override fun onCleared() {
        realtime?.stop()
    }

    /**
     * Aktif şubeyi değiştirir.
     *
     * **Sıra kritik: ÖNCE token deposu.** `X-Branch-Id` başlığının kaynağı
     * `TokenStore`; depoya yazılmadan yapılan bir istek hâlâ eski şubeye gider ve
     * kullanıcı ekranı değişmiş sanarken sunucu eski kapsamı okur.
     */
    fun switchBranch(branch: BranchSummary) {
        if (branch.id == _session.value.activeBranchId) return
        viewModelScope.launch {
            tokens.setBranch(branch.id)
            _session.update { it.copy(activeBranchId = branch.id) }
            _branchGeneration.update { it + 1 }
        }
    }

    /**
     * Şube listesini tazeler (A7.4) — şube eklendikten/düzenlendikten sonra. Seçili şube
     * pasife alındıysa ilk aktif şubeye geçilir. Hata [reloadProfile] gibi yutulur.
     */
    fun reloadBranches() {
        viewModelScope.launch {
            val fresh =
                try {
                    branches.list().map { it.toSummary() }
                } catch (_: ApiError) {
                    return@launch
                }
            _session.update { it.copy(branches = fresh) }
            val active = fresh.firstOrNull { it.id == _session.value.activeBranchId }
            if (active == null || !active.isActive) {
                fresh.firstOrNull { it.isActive }?.let(::switchBranch)
            }
        }
    }

    /**
     * Profili tazeler (telefon doğrulama, rol değişikliği sonrası).
     *
     * Hata **yutulur** — iOS'taki `try?` paritesi ve gerekçesi aynı: ikinci dereceden
     * bir tazeleme uğruna kullanıcının elindeki geçerli oturumu bozmak, bir ağ
     * kesintisini bir çıkışa çevirmek olurdu. Oturumu gerçekten geçersiz kılan token
     * hataları `ApiClient` tarafından zaten `sessionExpired` akışına dönüşüyor.
     */
    fun reloadProfile() {
        viewModelScope.launch {
            val refreshed =
                try {
                    auth.me()
                } catch (_: ApiError) {
                    return@launch
                }
            _session.update { it.copy(profile = refreshed) }
        }
    }

    companion object {
        /**
         * Başlangıç oturumu kompozisyondan geldiği için `viewModelFactory {}` yerine
         * açık bir fabrika: `initializer` yalnız `CreationExtras`'tan besleniyor ve
         * oturum orada yok.
         */
        fun factory(
            initial: AppSession,
            container: ServiceContainer,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    SessionViewModel(
                        initial,
                        container.auth,
                        container.tokens,
                        container.branches,
                        container.realtime,
                    ) as T
            }
    }
}
