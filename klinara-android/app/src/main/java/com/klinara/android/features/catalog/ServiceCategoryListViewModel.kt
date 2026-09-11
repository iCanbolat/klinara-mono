package com.klinara.android.features.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ServiceCategory
import com.klinara.android.services.catalog.UpdateServiceCategoryInput
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ServiceCategoryListUiState(
    val catalog: Loadable<CatalogSnapshot> = Loadable.Loading,
    val draft: CategoryForm? = null,
    /** Diyalog açıkken hata diyalogun İÇİNDE; arkadaki afiş görünmez. */
    val draftError: String? = null,
    val draftFieldErrors: Map<String, String> = emptyMap(),
    val isSaving: Boolean = false,
    val error: String? = null,
    val pendingDeactivation: ServiceCategory? = null,
) {
    /** Sıralı — pasifler DAHİL (iOS gibi): pasif kategori yeniden açılabilmeli. */
    val categories: List<ServiceCategory>
        get() =
            catalog.valueOrNull
                ?.categories
                .orEmpty()
                .sortedWith(compareBy<ServiceCategory> { it.sortOrder }.thenBy { it.name })
}

/**
 * Hizmet kategorileri (A7.1) — iOS `ServiceCategoryListView` paritesi.
 *
 * **Sıralama iki `PATCH`**: taşınan kategori komşunun `sortOrder`'ını, komşu da onunkini
 * alır. Sunucuda toplu sıralama ucu yok (Kural 1); ikinci yazma düşerse iki kategori aynı
 * sırayı taşır — bu yüzden her hatada liste **sunucudan yeniden çekilir**, yerel tahmin
 * gösterilmez.
 */
class ServiceCategoryListViewModel(
    private val catalog: CatalogService,
) : ViewModel() {
    private val _state = MutableStateFlow(ServiceCategoryListUiState())
    val state: StateFlow<ServiceCategoryListUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            if (_state.value.catalog !is Loadable.Loaded) _state.update { it.copy(catalog = Loadable.Loading) }
            val result = fetch()
            // Tazeleme düşerse eldeki liste durur; ilk yükleme düşerse hata görünür.
            if (result is Loadable.Loaded || _state.value.catalog !is Loadable.Loaded) {
                _state.update { it.copy(catalog = result) }
            }
        }
    }

    private suspend fun fetch(): Loadable<CatalogSnapshot> =
        Loadable.of { catalog.snapshot() }

    // --- Editör ---

    fun startCreate() =
        _state.update { it.copy(draft = CategoryForm(), draftError = null, draftFieldErrors = emptyMap()) }

    fun startEdit(category: ServiceCategory) =
        _state.update { it.copy(draft = CategoryForm.of(category), draftError = null, draftFieldErrors = emptyMap()) }

    fun updateDraft(transform: (CategoryForm) -> CategoryForm) =
        _state.update { state ->
            state.copy(draft = state.draft?.let(transform), draftError = null, draftFieldErrors = emptyMap())
        }

    fun cancelDraft() = _state.update { it.copy(draft = null, draftError = null, draftFieldErrors = emptyMap()) }

    fun saveDraft() {
        val current = _state.value
        val draft = current.draft ?: return
        if (current.isSaving || !draft.isValid || !draft.isDirty) return
        _state.update { it.copy(isSaving = true, draftError = null, draftFieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val saved =
                    if (draft.id == null) {
                        catalog.createCategory(draft.createInput(sortOrder = current.categories.size))
                    } else {
                        val input = draft.updateInput()
                        if (input.isEmpty) null else catalog.updateCategory(draft.id, input)
                    }
                _state.update { state ->
                    state.copy(
                        isSaving = false,
                        draft = null,
                        catalog = saved?.let { state.catalog.withCategory(it) } ?: state.catalog,
                    )
                }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSaving = false,
                        draftError = if (error.isFieldScoped) null else error.displayMessage,
                        draftFieldErrors = error.fieldErrors,
                    )
                }
            }
        }
    }

    // --- Sıralama ---

    fun move(
        category: ServiceCategory,
        offset: Int,
    ) {
        val current = _state.value
        if (current.isSaving) return
        val ordered = current.categories
        val index = ordered.indexOfFirst { it.id == category.id }
        val neighbour = ordered.getOrNull(index + offset) ?: return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                // Eşit sortOrder'lı iki kategori (eski veri) takas edilince yine eşit kalır;
                // o durumda sıra indeksten yeniden kurulur.
                val (mine, theirs) =
                    if (category.sortOrder == neighbour.sortOrder) {
                        (index + offset) to index
                    } else {
                        neighbour.sortOrder to category.sortOrder
                    }
                catalog.updateCategory(category.id, UpdateServiceCategoryInput(sortOrder = mine))
                catalog.updateCategory(neighbour.id, UpdateServiceCategoryInput(sortOrder = theirs))
                _state.update { it.copy(isSaving = false) }
                load()
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
                load()
            }
        }
    }

    // --- Pasife alma ---

    fun askDeactivate(category: ServiceCategory) = _state.update { it.copy(pendingDeactivation = category) }

    fun cancelDeactivate() = _state.update { it.copy(pendingDeactivation = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    /**
     * Aktif hizmeti olan kategori sunucuda pasife alınamaz (409). Hata **yutulmaz** — iOS
     * `try?` ile yutuyor ve kullanıcı neden olmadığını hiç öğrenmiyor.
     */
    fun confirmDeactivate() {
        val target = _state.value.pendingDeactivation ?: return
        if (_state.value.isSaving) return
        _state.update { it.copy(pendingDeactivation = null, isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val updated = catalog.deactivateCategory(target.id)
                _state.update { it.copy(isSaving = false, catalog = it.catalog.withCategory(updated)) }
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
                    ServiceCategoryListViewModel(container.catalog) as T
            }
    }
}

private fun Loadable<CatalogSnapshot>.withCategory(category: ServiceCategory): Loadable<CatalogSnapshot> {
    val snapshot = valueOrNull ?: return this
    val categories =
        if (snapshot.categories.any { it.id == category.id }) {
            snapshot.categories.map { if (it.id == category.id) category else it }
        } else {
            snapshot.categories + category
        }
    return Loadable.Loaded(snapshot.copy(categories = categories))
}
