package com.klinara.android.features.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.integrations.InboxItem
import com.klinara.android.services.integrations.WhatsAppService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

/** Gelen kutusunun tek süzgeci — `Boolean` yerine: seçici etiketleri okunur olsun. */
enum class InboxFilter(
    val title: String,
) {
    Unhandled("İşlenmemiş"),
    All("Tümü"),
}

data class InboxUiState(
    val filter: InboxFilter = InboxFilter.Unhandled,
    val items: Loadable<List<InboxItem>> = Loadable.Loading,
    val isSaving: Boolean = false,
    val error: String? = null,
)

/**
 * Gelen kutusu (A8.1) — iOS `InboxStore` paritesi.
 *
 * **Sayfalama yok, bilerek**: `GET /inbox` cursor vermiyor, yalnız `limit` alıyor. Rozet ya da
 * arka plan yoklaması da yok — push kanalı kapsam dışı (§9) ve bir sayacın peşinden koşmak pili
 * gerçek bir kazanç olmadan tüketirdi.
 */
class InboxViewModel(
    private val service: WhatsAppService,
    private val now: () -> Instant = Instant::now,
) : ViewModel() {
    private val _state = MutableStateFlow(InboxUiState())
    val state: StateFlow<InboxUiState> = _state.asStateFlow()

    fun load() {
        val filter = _state.value.filter
        viewModelScope.launch {
            val result = Loadable.of { service.inbox(onlyUnhandled = filter == InboxFilter.Unhandled) }
            // Yanıt gelene kadar süzgeç değiştiyse eski süzgecin sonucu yeni seçimin üstüne yazılmasın.
            _state.update { if (it.filter == filter) it.copy(items = result) else it }
        }
    }

    fun setFilter(filter: InboxFilter) {
        if (filter == _state.value.filter) return
        _state.update { it.copy(filter = filter, items = Loadable.Loading) }
        load()
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    /**
     * Yanıt gövdesiz (204) — satır sunucudan yeniden OKUNMAZ, yerel olarak damgalanır.
     * "İşlenmemiş" süzgecinde satır listeden düşer; yeniden yükleme kaydırma konumunu sıfırlardı.
     */
    fun markHandled(id: String) {
        if (_state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                service.markInboxHandled(id)
                _state.update { state ->
                    val items = state.items.valueOrNull ?: return@update state.copy(isSaving = false)
                    val updated =
                        if (state.filter == InboxFilter.Unhandled) {
                            items.filterNot { it.id == id }
                        } else {
                            items.map { if (it.id == id) it.copy(handledAt = now()) else it }
                        }
                    state.copy(items = Loadable.Loaded(updated), isSaving = false)
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = InboxViewModel(container.whatsapp) as T
            }
    }
}
