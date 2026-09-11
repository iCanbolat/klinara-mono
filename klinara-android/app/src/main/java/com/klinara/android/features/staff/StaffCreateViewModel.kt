package com.klinara.android.features.staff

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.UserProfile
import com.klinara.android.services.formatting.SearchText
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.staff.CreateStaffProfileInput
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import com.klinara.android.services.staff.UsersService
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Yeni profil formu. Yetkinlikler burada YOK — profil oluştuktan sonra matriste atanır (iOS gibi). */
data class StaffCreateForm(
    val userId: String? = null,
    val title: String = "",
    val specialties: List<String> = emptyList(),
    val calendarColor: String? = null,
    val primaryBranchId: String? = null,
    val isVisibleOnline: Boolean = true,
) {
    val isValid: Boolean get() = userId != null

    fun input(): CreateStaffProfileInput? =
        userId?.let {
            CreateStaffProfileInput(
                userId = it,
                primaryBranchId = primaryBranchId,
                title = title.trim().ifEmpty { null },
                specialties = specialties,
                calendarColor = calendarColor,
                isVisibleOnline = isVisibleOnline,
                isActive = true,
            )
        }
}

data class StaffCreateUiState(
    /** Profili OLMAYAN aktif kullanıcılar — sunucunun 409'u önceden önlenir. */
    val candidates: Loadable<List<UserProfile>> = Loadable.Loading,
    val form: StaffCreateForm = StaffCreateForm(),
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val created: StaffProfile? = null,
)

/**
 * Personel oluşturma (A7.2) — iOS `StaffCreateView` paritesi.
 *
 * Adaylar `GET users` − profili olanlar. Profil var olan bir kullanıcıya bağlandığı için
 * aday yoksa ekran davet yolunu anlatıyor; davet akışı bu istemcide yok (iOS'ta da yok).
 */
class StaffCreateViewModel(
    private val staff: StaffService,
    private val users: UsersService,
) : ViewModel() {
    private val _state = MutableStateFlow(StaffCreateUiState())
    val state: StateFlow<StaffCreateUiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.candidates is Loadable.Loaded) return
        _state.update { it.copy(candidates = Loadable.Loading) }
        viewModelScope.launch {
            val result =
                Loadable.of {
                    coroutineScope {
                        val profiles = async { staff.list() }
                        val all = async { users.users() }
                        candidatesFor(all.await(), profiles.await())
                    }
                }
            _state.update { it.copy(candidates = result) }
        }
    }

    fun update(transform: (StaffCreateForm) -> StaffCreateForm) =
        _state.update { it.copy(form = transform(it.form), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        val input = current.form.input() ?: return
        if (current.isSaving) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val created = staff.create(input)
                _state.update { it.copy(isSaving = false, created = created) }
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
        fun factory(container: ServiceContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    StaffCreateViewModel(container.staff, container.users) as T
            }
    }
}

/** Aktif ve henüz profili olmayan kullanıcılar, ada göre. */
internal fun candidatesFor(
    users: List<UserProfile>,
    profiles: List<StaffProfile>,
): List<UserProfile> {
    val taken = profiles.map { it.userId }.toSet()
    return users.filter { it.isActive && it.id !in taken }.sortedBy { SearchText.fold(it.fullName) }
}
