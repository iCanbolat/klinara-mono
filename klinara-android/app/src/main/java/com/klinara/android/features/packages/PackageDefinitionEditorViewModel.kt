package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.PackageDefinition
import com.klinara.android.services.packages.PackagesService
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PackageDefinitionEditorUiState(
    val form: PackageDefinitionForm = PackageDefinitionForm.empty(),
    /** Düzenlemede kayıt gelene kadar form çizilmez; oluşturmada `Loaded(null)`. */
    val loaded: Loadable<PackageDefinition?> = Loadable.Loading,
    val services: Loadable<List<ClinicService>> = Loadable.Loading,
    val isPickingService: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val saved: PackageDefinition? = null,
    /** Kaydedilen sürüm — `If-Match` bunu taşır ve her kayıttan sonra yenilenir. */
    internal val version: Int? = null,
) {
    /** Kaleme eklenebilecek hizmetler: aktif ve formda henüz olmayanlar. */
    val addableServices: List<ClinicService>
        get() =
            services.valueOrNull.orEmpty().filter { service ->
                service.isActive && form.items.none { it.serviceId == service.id }
            }
}

/**
 * Paket tanımı oluşturma ve düzenleme — tek ekran iki mod ([definitionId] null ise yeni).
 *
 * Tanım **açılışta yeniden çekilir**, listeden taşınmaz: listedeki `version` bayat olabilir
 * ve `If-Match` bayat başlarsa ilk kayıt boşuna `VERSION_CONFLICT` alır.
 */
class PackageDefinitionEditorViewModel(
    private val service: PackagesService,
    private val catalog: CatalogService,
    private val definitionId: String?,
    private val branchId: String?,
) : ViewModel() {
    private val _state = MutableStateFlow(PackageDefinitionEditorUiState())
    val state: StateFlow<PackageDefinitionEditorUiState> = _state.asStateFlow()

    val isNew: Boolean get() = definitionId == null

    fun load() {
        viewModelScope.launch {
            val services = async { Loadable.of { catalog.services() } }
            if (definitionId == null) {
                _state.update {
                    it.copy(loaded = Loadable.Loaded(null), form = PackageDefinitionForm.empty(branchId = null))
                }
            } else {
                _state.update { it.copy(loaded = Loadable.Loading) }
                when (val result = Loadable.of { service.definition(definitionId) }) {
                    is Loadable.Loaded ->
                        _state.update {
                            it.copy(
                                loaded = result,
                                form = PackageDefinitionForm.of(result.value),
                                version = result.value.version,
                            )
                        }
                    is Loadable.Failed -> _state.update { it.copy(loaded = result) }
                    Loadable.Loading -> Unit
                }
            }
            _state.update { it.copy(services = services.await()) }
        }
    }

    /** Form değişikliği yazma hatasını da temizler: kullanıcı düzeltirken eski hata durmamalı. */
    fun update(transform: (PackageDefinitionForm) -> PackageDefinitionForm) =
        _state.update { it.copy(form = transform(it.form), error = null, fieldErrors = emptyMap()) }

    fun setPickingService(value: Boolean) = _state.update { it.copy(isPickingService = value) }

    fun addService(service: ClinicService) =
        _state.update {
            // Fiyat, formun şube kapsamında değil DÜZENLEYENİN şubesinde okunur: kapsamı
            // "tüm şubeler" olan bir paketin tek bir şube fiyatı yoktur, en yakın doğru
            // önizleme kullanıcının baktığı şubenin fiyatıdır.
            it.copy(form = it.form.adding(service, it.form.branchId ?: branchId), isPickingService = false)
        }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        if (current.isSaving || !current.form.isValid || !current.form.isDirty) return
        // Düzenlemede sürüm yoksa kayıt henüz yüklenmemiştir; kör bir `If-Match` gönderilmez.
        val version = current.version
        if (definitionId != null && version == null) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val saved =
                    if (definitionId == null) {
                        service.createDefinition(current.form.createInput())
                    } else {
                        val input = current.form.updateInput()
                        if (input.isEmpty) {
                            service.definition(definitionId)
                        } else {
                            service.updateDefinition(definitionId, requireNotNull(version), input)
                        }
                    }
                _state.update { it.copy(isSaving = false, saved = saved, version = saved.version) }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSaving = false,
                        // Alan hatası varsa afiş YAZILMAZ: mesaj ilgili alanın altında.
                        error = if (error.isFieldScoped) null else error.displayMessage,
                        fieldErrors = error.fieldErrors,
                    )
                }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            definitionId: String?,
            branchId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    PackageDefinitionEditorViewModel(container.packages, container.catalog, definitionId, branchId) as T
            }
    }
}
