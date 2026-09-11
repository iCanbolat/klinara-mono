package com.klinara.android.features.scheduling

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.scheduling.SchedulingService
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class BranchHoursUiState(
    val loaded: Loadable<Unit> = Loadable.Loading,
    val draft: WeekHoursDraft? = null,
    val isSaving: Boolean = false,
    val error: String? = null,
    val didSave: Boolean = false,
)

/**
 * Şube çalışma saatleri (A7.3) — iOS `BranchHoursView` paritesi.
 *
 * ViewModel **şubeye bağlı** (anahtar şube kimliğini taşır): şube değişince yeni bir örnek
 * doğar, kirli bir taslak başka şubeye kaydedilemez. Kaydet → sunucunun yanıtı hem durumu
 * hem "orijinal"i yeniler.
 */
class BranchHoursViewModel(
    private val scheduling: SchedulingService,
    private val branchId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(BranchHoursUiState())
    val state: StateFlow<BranchHoursUiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.draft != null) return
        _state.update { it.copy(loaded = Loadable.Loading) }
        viewModelScope.launch {
            when (val result = Loadable.of { scheduling.branchHours(branchId) }) {
                is Loadable.Loaded ->
                    _state.update { it.copy(loaded = Loadable.Loaded(Unit), draft = WeekHoursDraft.of(result.value)) }
                is Loadable.Failed -> _state.update { it.copy(loaded = result) }
                Loadable.Loading -> Unit
            }
        }
    }

    fun update(transform: (WeekHoursDraft) -> WeekHoursDraft) =
        _state.update { it.copy(draft = it.draft?.let(transform), error = null, didSave = false) }

    fun dismissError() = _state.update { it.copy(error = null) }

    /** Geçersiz taslak GÖNDERİLMEZ — sunucunun yanıltıcı 409'una hiç düşülmez. */
    fun save() {
        val current = _state.value
        val draft = current.draft ?: return
        if (current.isSaving || !draft.isDirty || !draft.isValid) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val saved = scheduling.replaceBranchHours(branchId, draft.inputs())
                _state.update { it.copy(isSaving = false, draft = WeekHoursDraft.of(saved), didSave = true) }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            branchId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    BranchHoursViewModel(container.scheduling, branchId) as T
            }
    }
}

data class StaffScheduleUiState(
    val loaded: Loadable<Unit> = Loadable.Loading,
    val staffName: String? = null,
    val draft: StaffWeekDraft? = null,
    /** Sunucuda HİÇ kaydı yok — personel bu şubede slot üretmiyor; ekran bunu söyler. */
    val hasNoRecord: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val didSave: Boolean = false,
) {
    /** Kaydı olmayan personelde taslak "kirli" değil ama kaydedilebilir: varsayılanı yazmak bir karar. */
    val canSave: Boolean get() = draft != null && draft.isValid && (draft.isDirty || hasNoRecord)
}

/**
 * Personelin haftalık programı (A7.3) — iOS `StaffScheduleView` paritesi. Program
 * (personel, şube) başınadır; ViewModel ikisine birden bağlı.
 */
class StaffScheduleViewModel(
    private val scheduling: SchedulingService,
    private val staff: StaffService,
    private val staffProfileId: String,
    private val branchId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(StaffScheduleUiState())
    val state: StateFlow<StaffScheduleUiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.draft != null) return
        _state.update { it.copy(loaded = Loadable.Loading) }
        viewModelScope.launch {
            val result =
                Loadable.of {
                    coroutineScope {
                        val profile = async { staff.profile(staffProfileId) }
                        val schedule = async { scheduling.staffSchedule(staffProfileId, branchId) }
                        profile.await() to schedule.await()
                    }
                }
            when (result) {
                is Loadable.Loaded -> {
                    val (profile, schedule) = result.value
                    _state.update {
                        it.copy(
                            loaded = Loadable.Loaded(Unit),
                            staffName = profile.userFullName,
                            draft = StaffWeekDraft.of(schedule),
                            hasNoRecord = schedule.entries.isEmpty(),
                        )
                    }
                }
                is Loadable.Failed -> _state.update { it.copy(loaded = result) }
                Loadable.Loading -> Unit
            }
        }
    }

    fun update(transform: (StaffWeekDraft) -> StaffWeekDraft) =
        _state.update { it.copy(draft = it.draft?.let(transform), error = null, didSave = false) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        val draft = current.draft ?: return
        if (current.isSaving || !current.canSave) return
        _state.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                val saved = scheduling.replaceStaffSchedule(staffProfileId, branchId, draft.inputs())
                _state.update {
                    it.copy(isSaving = false, draft = StaffWeekDraft.of(saved), hasNoRecord = false, didSave = true)
                }
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            staffProfileId: String,
            branchId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    StaffScheduleViewModel(container.scheduling, container.staff, staffProfileId, branchId) as T
            }
    }
}
