package com.klinara.android.features.staff

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.SearchText
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class StaffListUiState(
    val profiles: Loadable<List<StaffProfile>> = Loadable.Loading,
)

/**
 * Personel listesi (A7.2) — iOS `StaffListView` paritesi.
 *
 * Oturum ömürlü `StaffStore` yok (A5.1 kararı); ekran açılışta kendi çeker, detay ya da
 * oluşturmadan dönüşte **sessizce** tazeler.
 */
class StaffListViewModel(
    private val staff: StaffService,
) : ViewModel() {
    private val _state = MutableStateFlow(StaffListUiState())
    val state: StateFlow<StaffListUiState> = _state.asStateFlow()

    private var loadJob: Job? = null

    fun ensureLoaded() {
        if (_state.value.profiles is Loadable.Loaded) refreshSilently() else reload()
    }

    fun reload() {
        loadJob?.cancel()
        _state.update { it.copy(profiles = Loadable.Loading) }
        loadJob = viewModelScope.launch { _state.update { it.copy(profiles = Loadable.of { staff.list() }) } }
    }

    private fun refreshSilently() {
        if (loadJob?.isActive == true) return
        loadJob =
            viewModelScope.launch {
                val result = Loadable.of { staff.list() }
                if (result is Loadable.Loaded) _state.update { it.copy(profiles = result) }
            }
    }

    companion object {
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = StaffListViewModel(container.staff) as T
            }
    }
}

/**
 * Liste süzgeci: pasifler istenmedikçe gizli; arama ad, unvan ve uzmanlıklarda Türkçe
 * duyarlı; sıra ada göre (iOS `StaffListView.filtered`). [branchId] verilirse yalnız o
 * şubeye ait personel (A7.4–A7.5 — ana şube VEYA şube üyeliği, [StaffProfile.worksIn]).
 */
internal fun filteredStaff(
    profiles: List<StaffProfile>,
    query: String,
    showsInactive: Boolean,
    branchId: String? = null,
): List<StaffProfile> =
    profiles
        .filter { branchId == null || it.worksIn(branchId) }
        .filter { showsInactive || it.isActive }
        .filter { profile ->
            SearchText.matches(profile.userFullName, query) ||
                SearchText.matches(profile.title.orEmpty(), query) ||
                profile.specialties.any { SearchText.matches(it, query) }
        }.sortedBy { SearchText.fold(it.userFullName) }
