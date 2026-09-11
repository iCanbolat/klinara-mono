package com.klinara.android.features.staff

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class StaffDetailUiState(
    val profile: Loadable<StaffProfile> = Loadable.Loading,
    val draft: StaffProfileDraft = StaffProfileDraft(),
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** "Değişiklikler kaydedildi." — bir sonraki düzenlemede düşer. */
    val didSave: Boolean = false,
)

/**
 * Personel detayı (A7.2) — iOS `StaffDetailView` paritesi.
 *
 * Profil açılışta **yeniden çekilir** (`GET staff/:id`), listeden taşınmaz. Matristen dönüşte
 * kayıt tazelenir ama kaydedilmemiş bir taslak varsa **ezilmez** — yalnız yetkinlik sayısı
 * için profil yenilenir.
 */
class StaffDetailViewModel(
    private val staff: StaffService,
    private val staffId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(StaffDetailUiState())
    val state: StateFlow<StaffDetailUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            val loaded = _state.value.profile is Loadable.Loaded
            if (!loaded) _state.update { it.copy(profile = Loadable.Loading) }
            when (val result = Loadable.of { staff.profile(staffId) }) {
                is Loadable.Loaded ->
                    _state.update {
                        it.copy(
                            profile = result,
                            draft = if (it.draft.isDirty) it.draft else StaffProfileDraft.of(result.value),
                        )
                    }
                is Loadable.Failed -> if (!loaded) _state.update { it.copy(profile = result) }
                Loadable.Loading -> Unit
            }
        }
    }

    fun update(transform: (StaffProfileDraft) -> StaffProfileDraft) =
        _state.update { it.copy(draft = transform(it.draft), error = null, fieldErrors = emptyMap(), didSave = false) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        if (current.isSaving || !current.draft.isDirty) return
        val input = current.draft.updateInput()
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val saved = staff.update(staffId, input)
                _state.update {
                    it.copy(
                        isSaving = false,
                        profile = Loadable.Loaded(saved),
                        draft = StaffProfileDraft.of(saved),
                        didSave = true,
                    )
                }
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
            staffId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    StaffDetailViewModel(container.staff, staffId) as T
            }
    }
}
