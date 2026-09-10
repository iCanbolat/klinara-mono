package com.klinara.android.features.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.AuthService
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.networking.ApiError
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
                    SessionViewModel(initial, container.auth, container.tokens) as T
            }
    }
}
