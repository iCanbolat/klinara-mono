package com.klinara.android.features.branches

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.branches.BranchDetail
import com.klinara.android.services.branches.BranchSlug
import com.klinara.android.services.branches.BranchesService
import com.klinara.android.services.branches.CreateBranchInput
import com.klinara.android.services.branches.UpdateBranchInput
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Şubeler listesi (A7.4). Aktifler önce, sonra ada göre; pasifler rozetle listede kalır.
 * Oturum ömürlü depo yok (A5.1): açılışta çeker, editörden dönüşte sessizce tazeler.
 */
class BranchListViewModel(
    private val branches: BranchesService,
) : ViewModel() {
    private val _state = MutableStateFlow<Loadable<List<BranchDetail>>>(Loadable.Loading)
    val state: StateFlow<Loadable<List<BranchDetail>>> = _state.asStateFlow()

    fun load() {
        val silent = _state.value is Loadable.Loaded
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            val result = Loadable.of { sortedBranches(branches.list()) }
            if (!silent || result is Loadable.Loaded) _state.value = result
        }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    BranchListViewModel(container.branches) as T
            }
    }
}

internal fun sortedBranches(list: List<BranchDetail>): List<BranchDetail> =
    list.sortedWith(compareByDescending<BranchDetail> { it.isActive }.thenBy { it.name.lowercase() })

/**
 * Şube formu taslağı — saf; doğrulama ve PATCH farkı burada, ekranda değil.
 *
 * Kod (slug) addan önerilir; kullanıcı alana dokunduğu anda öneri durur ([slugTouched]).
 */
data class BranchDraft(
    val original: BranchDetail? = null,
    val name: String = original?.name.orEmpty(),
    val slug: String = original?.slug.orEmpty(),
    val slugTouched: Boolean = original != null,
    val timezone: String = original?.timezone ?: "Europe/Istanbul",
    val phone: String = original?.phone.orEmpty(),
    val address: String = original?.address.orEmpty(),
    val isActive: Boolean = original?.isActive ?: true,
) {
    val isCreate: Boolean get() = original == null

    fun withName(value: String): BranchDraft =
        copy(name = value, slug = if (isCreate && !slugTouched) BranchSlug.suggest(value) else slug)

    fun withSlug(value: String): BranchDraft = copy(slug = value.lowercase(), slugTouched = true)

    val slugError: String?
        get() =
            if (isCreate && slug.isNotEmpty() && !BranchSlug.isValid(slug)) {
                "3–50 karakter; küçük harf, rakam ve tire."
            } else {
                null
            }

    val isDirty: Boolean
        get() = if (original == null) name.isNotBlank() || slug.isNotBlank() else !updateInput(original).isEmpty

    val isValid: Boolean
        get() = name.isNotBlank() && (!isCreate || BranchSlug.isValid(slug))

    /** Aktif bir şubeyi pasife almak — kaydetmeden önce ayrıca onay istenir. */
    val deactivates: Boolean get() = original?.isActive == true && !isActive

    fun createInput(): CreateBranchInput =
        CreateBranchInput(
            slug = slug,
            name = name.trim(),
            timezone = timezone,
            phone = phone.trim().ifEmpty { null },
            address = address.trim().ifEmpty { null },
        )

    fun updateInput(from: BranchDetail): UpdateBranchInput =
        UpdateBranchInput(
            name = name.trim().takeIf { it != from.name },
            timezone = timezone.takeIf { it != from.timezone },
            phone = if (phone.trim() != from.phone.orEmpty()) Patch.text(phone) else Patch.Unchanged,
            address = if (address.trim() != from.address.orEmpty()) Patch.text(address) else Patch.Unchanged,
            isActive = isActive.takeIf { it != from.isActive },
        )
}

data class BranchEditorUiState(
    val draft: BranchDraft = BranchDraft(),
    val loaded: Boolean = false,
    val isSaving: Boolean = false,
    val confirmsDeactivation: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val saved: BranchDetail? = null,
)

/** Şube oluşturma/düzenleme (A7.4) — iOS `BranchFormView` paritesi. */
class BranchEditorViewModel(
    private val branches: BranchesService,
    private val branchId: String?,
) : ViewModel() {
    private val _state = MutableStateFlow(BranchEditorUiState(loaded = branchId == null))
    val state: StateFlow<BranchEditorUiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.loaded || branchId == null) return
        viewModelScope.launch {
            try {
                val branch = branches.list().firstOrNull { it.id == branchId }
                _state.update {
                    if (branch == null) {
                        it.copy(error = "Şube bulunamadı.")
                    } else {
                        it.copy(draft = BranchDraft(original = branch), loaded = true)
                    }
                }
            } catch (error: ApiError) {
                _state.update { it.copy(error = error.displayMessage) }
            }
        }
    }

    fun update(transform: (BranchDraft) -> BranchDraft) =
        _state.update { it.copy(draft = transform(it.draft), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun cancelDeactivation() = _state.update { it.copy(confirmsDeactivation = false) }

    /** Pasife alma varsa önce onay; onaydan sonra [confirmSave]. */
    fun save() {
        val draft = _state.value.draft
        if (!draft.isValid || !draft.isDirty || _state.value.isSaving) return
        if (draft.deactivates) _state.update { it.copy(confirmsDeactivation = true) } else confirmSave()
    }

    fun confirmSave() {
        val draft = _state.value.draft
        _state.update { it.copy(confirmsDeactivation = false, isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val original = draft.original
                val saved =
                    if (original == null) {
                        branches.create(draft.createInput())
                    } else {
                        branches.update(original.id, draft.updateInput(original))
                    }
                _state.update { it.copy(isSaving = false, saved = saved, draft = BranchDraft(original = saved)) }
            } catch (error: ApiError) {
                _state.update {
                    it.copy(
                        isSaving = false,
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
            branchId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    BranchEditorViewModel(container.branches, branchId) as T
            }
    }
}
