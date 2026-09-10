package com.klinara.android.features.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.CustomerService
import com.klinara.android.services.crm.CustomerTag
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Düzenlenmekte olan etiket; [CustomerTagDraft.id] null ise yeni. */
data class CustomerTagDraft(
    val id: String? = null,
    val name: String = "",
    val color: String? = null,
) {
    val isValid: Boolean get() = name.isNotBlank()
}

data class CustomerTagListUiState(
    val tags: Loadable<List<CustomerTag>> = Loadable.Loading,
    val draft: CustomerTagDraft? = null,
    val pendingDelete: CustomerTag? = null,
    val isSaving: Boolean = false,
    val error: String? = null,
)

/**
 * Etiket yönetimi — kiracı kapsamlı.
 *
 * **Yönetim sekmesinde yaşıyor**, müşteri kartında değil: kiracı kapsamlı bir kavramı
 * her karttan yaratılabilir kılmak, birbirinden biraz farklı yazılmış üç "VIP" demekti.
 * Kartta etiket **seçilir**, burada **tanımlanır**.
 */
class CustomerTagListViewModel(
    private val customers: CustomerService,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerTagListUiState())
    val state: StateFlow<CustomerTagListUiState> = _state.asStateFlow()

    fun load() {
        _state.update { it.copy(tags = Loadable.Loading) }
        viewModelScope.launch {
            _state.update { it.copy(tags = Loadable.of { customers.tags() }) }
        }
    }

    fun startCreate() = _state.update { it.copy(draft = CustomerTagDraft()) }

    fun startEdit(tag: CustomerTag) =
        _state.update { it.copy(draft = CustomerTagDraft(id = tag.id, name = tag.name, color = tag.color)) }

    fun updateDraft(transform: (CustomerTagDraft) -> CustomerTagDraft) =
        _state.update { it.copy(draft = it.draft?.let(transform), error = null) }

    fun cancelDraft() = _state.update { it.copy(draft = null, error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun askDelete(tag: CustomerTag) = _state.update { it.copy(pendingDelete = tag) }

    fun cancelDelete() = _state.update { it.copy(pendingDelete = null) }

    fun saveDraft() {
        val draft = _state.value.draft ?: return
        if (!draft.isValid) return

        mutate {
            if (draft.id == null) {
                customers.createTag(draft.name.trim(), draft.color)
            } else {
                // Renk `Patch`: null seçmek "renksiz yap" demek, "dokunma" değil.
                customers.updateTag(draft.id, draft.name.trim(), Patch.orClear(draft.color))
            }
            _state.update { it.copy(draft = null) }
        }
    }

    fun confirmDelete() {
        val tag = _state.value.pendingDelete ?: return
        _state.update { it.copy(pendingDelete = null) }
        mutate { customers.deleteTag(tag.id) }
    }

    /**
     * Yazma sonrası listeyi yeniden çeker.
     *
     * Etiket adı değişince kartlardaki rozetler de değişmeli; yerel bir yama listeyi
     * güncellerken müşterilerin taşıdığı kopyaları eskitirdi.
     */
    private fun mutate(block: suspend () -> Unit) {
        if (_state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                block()
                _state.update { it.copy(isSaving = false, tags = Loadable.of { customers.tags() }) }
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
                    CustomerTagListViewModel(container.customers) as T
            }
    }
}
