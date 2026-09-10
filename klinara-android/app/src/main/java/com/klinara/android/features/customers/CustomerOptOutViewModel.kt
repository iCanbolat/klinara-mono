package com.klinara.android.features.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.NotificationsService
import com.klinara.android.services.notifications.OptOutRecord
import com.klinara.android.services.notifications.OptOutSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerOptOutUiState(
    val records: Loadable<List<OptOutRecord>> = Loadable.Loading,
    val isSaving: Boolean = false,
    val error: String? = null,
) {
    /** Kanalsız (`channel == null`) bir kayıt TÜM kanalları kapatır. */
    val blocksEverything: Boolean
        get() = records.valueOrNull.orEmpty().any { it.channel == null }

    val isOptedOut: Boolean get() = records.valueOrNull.orEmpty().isNotEmpty()
}

/**
 * Müşterinin ileti tercihleri.
 *
 * **İzin `customer:*` değil `notification:*`** — bölüm müşteri kartında duruyor ama
 * kayıt bir iletişim kaydı. `notification:read` yoksa bu ViewModel hiç kurulmaz.
 */
class CustomerOptOutViewModel(
    private val notifications: NotificationsService,
    private val customerId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerOptOutUiState())
    val state: StateFlow<CustomerOptOutUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(records = Loadable.of { notifications.optOuts(customerId) }) }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun optOut(
        channel: NotificationChannel?,
        source: OptOutSource = OptOutSource.CustomerRequest,
    ) = mutate { notifications.createOptOut(customerId, channel, source) }

    fun revoke(channel: NotificationChannel?) = mutate { notifications.revokeOptOut(customerId, channel) }

    /**
     * Yazma sonrası listeyi **yeniden çeker**.
     *
     * Yerel olarak eklemek/çıkarmak iyimser güncelleme olurdu; sunucu kaydı
     * idempotent birleştirebiliyor (aynı kapsam iki kez kapatılamaz) ve elde tutulan
     * kopya sessizce sunucudan ayrışırdı.
     */
    private fun mutate(block: suspend () -> Unit) {
        if (_state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                block()
                _state.update { it.copy(isSaving = false, records = Loadable.of { notifications.optOuts(customerId) }) }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            customerId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerOptOutViewModel(container.notifications, customerId) as T
            }
    }
}
