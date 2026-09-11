package com.klinara.android.features.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.ServiceCategory
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ServiceEditorUiState(
    val form: ServiceForm = ServiceForm.empty(),
    /** Düzenlemede kayıt gelene kadar form çizilmez; oluşturmada `Loaded(null)`. */
    val loaded: Loadable<ClinicService?> = Loadable.Loading,
    val categories: Loadable<List<ServiceCategory>> = Loadable.Loading,
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val saved: ClinicService? = null,
) {
    /**
     * Kategori seçeneği: aktifler + formda seçili olan (pasif olsa bile). Seçili pasif
     * kategoriyi listeden atmak, düzenlenen hizmetin kategorisini ekranda "boş" gösterirdi.
     */
    val categoryOptions: List<ServiceCategory>
        get() =
            categories.valueOrNull
                .orEmpty()
                .filter { it.isActive || it.id == form.categoryId }
                .sortedWith(compareBy<ServiceCategory> { it.sortOrder }.thenBy { it.name })
}

/**
 * Hizmet oluşturma ve düzenleme — tek ekran iki mod ([serviceId] null ise yeni).
 *
 * Kayıt açılışta **yeniden çekilir**, listeden taşınmaz: route yalnız kimlik taşır (§5.2)
 * ve listedeki kopya başka bir oturumun yazdığını kaçırmış olabilir.
 */
class ServiceEditorViewModel(
    private val catalog: CatalogService,
    private val serviceId: String?,
) : ViewModel() {
    private val _state = MutableStateFlow(ServiceEditorUiState())
    val state: StateFlow<ServiceEditorUiState> = _state.asStateFlow()

    val isNew: Boolean get() = serviceId == null

    fun load() {
        // Kaydetmeden dönüp yeniden açılışta formu ezmemek için: yüklüyse dokunma.
        if (_state.value.loaded is Loadable.Loaded) return
        viewModelScope.launch {
            _state.update { it.copy(loaded = Loadable.Loading) }
            val categories = async { Loadable.of { catalog.categories() } }
            val loaded: Loadable<ClinicService?> =
                if (serviceId == null) Loadable.Loaded(null) else Loadable.of { catalog.service(serviceId) }
            val categoryResult = categories.await()
            _state.update { state ->
                val form =
                    when (val value = loaded.valueOrNull) {
                        null ->
                            ServiceForm.empty(
                                categoryId =
                                    categoryResult.valueOrNull
                                        .orEmpty()
                                        .filter { it.isActive }
                                        .minWithOrNull(compareBy<ServiceCategory> { it.sortOrder }.thenBy { it.name })
                                        ?.id
                                        .orEmpty(),
                            )
                        else -> ServiceForm.of(value)
                    }
                state.copy(loaded = loaded, categories = categoryResult, form = form)
            }
        }
    }

    /** Form değişikliği yazma hatasını da temizler: kullanıcı düzeltirken eski hata durmamalı. */
    fun update(transform: (ServiceForm) -> ServiceForm) =
        _state.update { it.copy(form = transform(it.form), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        if (current.isSaving || !current.form.isValid || !current.form.isDirty) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val saved =
                    if (serviceId == null) {
                        catalog.createService(current.form.createInput())
                    } else {
                        val input = current.form.updateInput()
                        if (input.isEmpty) catalog.service(serviceId) else catalog.updateService(serviceId, input)
                    }
                _state.update { it.copy(isSaving = false, saved = saved) }
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
            serviceId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ServiceEditorViewModel(container.catalog, serviceId) as T
            }
    }
}
