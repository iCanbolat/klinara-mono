package com.klinara.android.features.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ServiceListUiState(
    val catalog: Loadable<CatalogSnapshot> = Loadable.Loading,
    val isSaving: Boolean = false,
    val error: String? = null,
    val pendingDeactivation: ClinicService? = null,
)

/**
 * Hizmet listesi (A7.1).
 *
 * Kategoriler ve hizmetler **paralel** çekilir (iOS `CatalogStore.load` gibi); biri düşerse
 * liste düşer — kategorisiz bir liste gruplanamaz, hizmetsiz bir liste de boş değildir.
 *
 * **iOS'tan sapma:** pasife alma hatası YUTULMAZ. iOS `try?` kullanıyor; burada hata
 * afişe düşer — kullanıcı "pasife aldım" sanıp listede aktif bir satır görmemeli.
 */
class ServiceListViewModel(
    private val catalog: CatalogService,
) : ViewModel() {
    private val _state = MutableStateFlow(ServiceListUiState())
    val state: StateFlow<ServiceListUiState> = _state.asStateFlow()

    private var loadJob: Job? = null

    /**
     * Ekran her açıldığında çağrılır (editörden dönüş dahil). Yüklüyse **sessizce tazeler**:
     * eldeki liste yerinde durur, yalnız başarılı yanıt onu değiştirir.
     */
    fun ensureLoaded() {
        if (_state.value.catalog is Loadable.Loaded) refreshSilently() else reload()
    }

    fun reload() {
        loadJob?.cancel()
        _state.update { it.copy(catalog = Loadable.Loading) }
        loadJob = viewModelScope.launch { _state.update { it.copy(catalog = fetch()) } }
    }

    private fun refreshSilently() {
        if (loadJob?.isActive == true) return
        loadJob =
            viewModelScope.launch {
                val result = fetch()
                if (result is Loadable.Loaded) _state.update { it.copy(catalog = result) }
            }
    }

    private suspend fun fetch(): Loadable<CatalogSnapshot> =
        Loadable.of { catalog.snapshot() }

    fun askDeactivate(service: ClinicService) = _state.update { it.copy(pendingDeactivation = service) }

    fun cancelDeactivate() = _state.update { it.copy(pendingDeactivation = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun confirmDeactivate() {
        val target = _state.value.pendingDeactivation ?: return
        if (_state.value.isSaving) return
        _state.update { it.copy(pendingDeactivation = null, isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val updated = catalog.deactivateService(target.id)
                _state.update { state ->
                    val snapshot = state.catalog.valueOrNull
                    state.copy(
                        isSaving = false,
                        catalog =
                            snapshot
                                ?.let { Loadable.Loaded(it.copy(services = it.services.replacing(updated))) }
                                ?: state.catalog,
                    )
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
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ServiceListViewModel(container.catalog) as T
            }
    }
}

internal fun List<ClinicService>.replacing(updated: ClinicService): List<ClinicService> =
    map { if (it.id == updated.id) updated else it }
