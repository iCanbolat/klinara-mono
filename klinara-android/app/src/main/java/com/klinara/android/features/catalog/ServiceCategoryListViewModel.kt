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
    /**
     * Sürükleyerek sıralama sürüyor.
     *
     * [isSaving]'den AYRI: o, ekranı kilitleyen "Kaydediliyor…" örtüsünü açıyor ve
     * sürüklemenin ardından ekranın yarım saniye donması, taşımayı bir kayıt işlemi gibi
     * gösterirdi. Sıralama iyimser uygulanır, örtü açılmaz.
     */
    val isReordering: Boolean = false,
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
 * **Sıralama kayıt başına `PATCH`**: sunucuda toplu sıralama ucu yok (Kural 1) ve
 * sürükleme bitişik olmayan bir hedefe bırakılabildiği için, etkilenen aralık yeniden
 * numaralanıp yalnız sırası değişen kayıtlar yazılır. Yazmalardan biri düşerse iki kategori
 * aynı sırayı taşıyabilir — bu yüzden her hatada liste **sunucudan yeniden çekilir**.
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

    /**
     * [from] indeksindeki kategoriyi [to] indeksine taşır.
     *
     * Komşuyla takas değil **yeniden numaralama**: sürükleme bitişik olmayan bir hedefe
     * bırakılabiliyor ve art arda takas etmek, aradaki her kayda iki yazma demekti. Yalnız
     * sırası gerçekten değişen kayıtlar `PATCH` edilir.
     *
     * Sıra önce **yerel olarak** uygulanır: sürüklenen satırın parmağın altından eski
     * yerine geri zıplaması, işlemin başarısız olduğunu düşündürürdü. Sunucu cevabı
     * geldiğinde liste yine de yeniden çekilir — ikinci yazma düşmüşse doğru sırayı
     * sunucu söyler, yerel tahmin değil.
     */
    fun moveTo(
        from: Int,
        to: Int,
    ) {
        val current = _state.value
        if (current.isSaving || current.isReordering || from == to) return
        val ordered = current.categories.toMutableList()
        if (from !in ordered.indices || to !in ordered.indices) return

        ordered.add(to, ordered.removeAt(from))
        val renumbered = ordered.mapIndexed { index, category -> category.copy(sortOrder = index) }
        val previousOrder = current.categories.associate { it.id to it.sortOrder }
        val changed = renumbered.filter { previousOrder[it.id] != it.sortOrder }
        if (changed.isEmpty()) return

        _state.update { it.copy(catalog = it.catalog.withCategories(renumbered), isReordering = true, error = null) }
        viewModelScope.launch {
            try {
                changed.forEach { category ->
                    catalog.updateCategory(category.id, UpdateServiceCategoryInput(sortOrder = category.sortOrder))
                }
                _state.update { it.copy(isReordering = false) }
                load()
            } catch (error: ApiError) {
                _state.update { it.copy(isReordering = false, error = error.displayMessage) }
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
        // Panel de kapanır: pasife alınan kategorinin düzenleme formu açık kalırsa, kullanıcı
        // az önce kapattığı kaydı hâlâ "Aktif" anahtarıyla görür. Vazgeçilirse panel durur.
        _state.update { it.copy(pendingDeactivation = null, draft = null, isSaving = true, error = null) }
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

/** Sıralama sonrası tüm kategori kümesini değiştirir — tek tek `withCategory` çağırmak yerine. */
private fun Loadable<CatalogSnapshot>.withCategories(categories: List<ServiceCategory>): Loadable<CatalogSnapshot> {
    val snapshot = valueOrNull ?: return this
    return Loadable.Loaded(snapshot.copy(categories = categories))
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
