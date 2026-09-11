package com.klinara.android.features.staff

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.features.catalog.CatalogSnapshot
import com.klinara.android.features.catalog.snapshot
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.ReplaceStaffServicesInput
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class StaffServiceMatrixUiState(
    val loaded: Loadable<Pair<StaffProfile, CatalogSnapshot>> = Loadable.Loading,
    val draft: SkillMatrixDraft? = null,
    val isSaving: Boolean = false,
    val error: String? = null,
    val didSave: Boolean = false,
)

/**
 * Personel–hizmet yetkinlik matrisi (A7.2) — iOS `StaffServiceMatrixView` paritesi.
 *
 * Tek "Kaydet": `PUT staff/:id/services` listeyi tamamen değiştiriyor, satır satır kayıt
 * yok. Profil ve katalog paralel çekilir; matris yalnız AKTİF hizmetleri gösterir.
 */
class StaffServiceMatrixViewModel(
    private val staff: StaffService,
    private val catalog: CatalogService,
    private val staffId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(StaffServiceMatrixUiState())
    val state: StateFlow<StaffServiceMatrixUiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.loaded is Loadable.Loaded) return
        _state.update { it.copy(loaded = Loadable.Loading) }
        viewModelScope.launch {
            val result =
                Loadable.of {
                    coroutineScope {
                        val profile = async { staff.profile(staffId) }
                        val snapshot = async { catalog.snapshot() }
                        profile.await() to snapshot.await()
                    }
                }
            _state.update { state ->
                state.copy(
                    loaded = result,
                    draft =
                        result.valueOrNull?.let { (profile, snapshot) ->
                            SkillMatrixDraft.of(profile.services, snapshot.services)
                        },
                )
            }
        }
    }

    fun update(transform: (SkillMatrixDraft) -> SkillMatrixDraft) =
        _state.update { it.copy(draft = it.draft?.let(transform), error = null, didSave = false) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        val draft = current.draft ?: return
        if (current.isSaving || !draft.isDirty) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val saved = staff.replaceSkills(staffId, ReplaceStaffServicesInput(draft.wire()))
                _state.update { state ->
                    val snapshot = state.loaded.valueOrNull?.second
                    state.copy(
                        isSaving = false,
                        didSave = true,
                        loaded = snapshot?.let { Loadable.Loaded(saved to it) } ?: state.loaded,
                        draft = snapshot?.let { SkillMatrixDraft.of(saved.services, it.services) },
                    )
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
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
                    StaffServiceMatrixViewModel(container.staff, container.catalog, staffId) as T
            }
    }
}
