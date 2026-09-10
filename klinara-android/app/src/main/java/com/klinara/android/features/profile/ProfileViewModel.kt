package com.klinara.android.features.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.AuthService
import com.klinara.android.services.auth.PasskeySummary
import com.klinara.android.services.auth.TotpStatus
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Bir kartın yükleme durumu.
 *
 * Ekranın tamamı için tek bir `isLoading` yeterli DEĞİL: TOTP durumu ile passkey
 * listesi iki ayrı çağrıdan geliyor ve biri düşerken diğeri gelmiş olabilir. Tek
 * bayrak, gelmiş olan veriyi de gizlerdi.
 */
sealed interface Loadable<out T> {
    data object Loading : Loadable<Nothing>

    data class Loaded<T>(val value: T) : Loadable<T>

    data class Failed(val message: String, val isRetryable: Boolean) : Loadable<Nothing>
}

data class ProfileUiState(
    val totp: Loadable<TotpStatus> = Loadable.Loading,
    val passkeys: Loadable<List<PasskeySummary>> = Loadable.Loading,
    /** Silinmekte olan anahtarın kimliği — yalnız o satır meşgul görünür. */
    val deletingPasskeyId: String? = null,
    /** Silme reddedildiğinde afiş. Liste DEĞİŞMEZ. */
    val deleteError: String? = null,
)

/**
 * Profil ekranının verisi.
 *
 * İki ikincil çağrı **paralel** yapılır ve **birbirinden bağımsız** başarısız olur:
 * kullanıcının kim olduğu zaten `AppSession`'da; TOTP durumu gelmedi diye e-postasını
 * ve şubesini gizlemek, ikinci dereceden bir bilgi uğruna birinci dereceden olanı
 * saklamak olurdu.
 */
class ProfileViewModel(
    private val auth: AuthService,
) : ViewModel() {
    private val _state = MutableStateFlow(ProfileUiState())
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    fun load() {
        _state.update { it.copy(totp = Loadable.Loading, passkeys = Loadable.Loading) }
        viewModelScope.launch {
            listOf(
                async { loadTotp() },
                async { loadPasskeys() },
            ).awaitAll()
        }
    }

    fun retryTotp() = viewModelScope.launch { loadTotp() }

    fun retryPasskeys() = viewModelScope.launch { loadPasskeys() }

    fun dismissDeleteError() = _state.update { it.copy(deleteError = null) }

    /**
     * Anahtarı siler.
     *
     * 409 `CREDENTIAL_REQUIRED` beklenen bir yoldur (parolasız hesap kendini
     * kilitlemesin diye) ve **liste değişmeden** bir afişe dönüşür. İyimser silme
     * yapılmıyor: satırı önce kaldırıp sonra geri koymak, kullanıcıya bir an için
     * gerçekleşmemiş bir şeyi göstermek olurdu.
     */
    fun deletePasskey(id: String) {
        if (_state.value.deletingPasskeyId != null) return
        _state.update { it.copy(deletingPasskeyId = id, deleteError = null) }
        viewModelScope.launch {
            try {
                auth.deletePasskey(id)
            } catch (error: ApiError) {
                _state.update { it.copy(deletingPasskeyId = null, deleteError = error.displayMessage) }
                return@launch
            }
            _state.update { it.copy(deletingPasskeyId = null) }
            loadPasskeys()
        }
    }

    private suspend fun loadTotp() {
        val next =
            try {
                Loadable.Loaded(auth.totpStatus())
            } catch (error: ApiError) {
                Loadable.Failed(error.displayMessage, error.isRetryable)
            }
        _state.update { it.copy(totp = next) }
    }

    private suspend fun loadPasskeys() {
        val next =
            try {
                Loadable.Loaded(auth.passkeys())
            } catch (error: ApiError) {
                Loadable.Failed(error.displayMessage, error.isRetryable)
            }
        _state.update { it.copy(passkeys = next) }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = ProfileViewModel(container.auth) as T
            }
    }
}
