package com.klinara.android.features.scheduling

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.scheduling.ScheduleException
import com.klinara.android.services.scheduling.ScheduleExceptionQuery
import com.klinara.android.services.scheduling.ScheduleRecurrence
import com.klinara.android.services.scheduling.SchedulingService
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

/** Liste aralığı — iOS menüsündeki seçenekler. */
enum class ExceptionRange(
    val days: Long,
    val title: String,
) {
    Month(DAYS_MONTH, "30 gün"),
    Quarter(DAYS_QUARTER, "90 gün"),
    Year(DAYS_YEAR, "1 yıl"),
}

private const val DAYS_MONTH = 30L
private const val DAYS_QUARTER = 90L
private const val DAYS_YEAR = 365L

data class ScheduleExceptionListUiState(
    val range: ExceptionRange = ExceptionRange.Month,
    val rows: Loadable<List<ScheduleException>> = Loadable.Loading,
    val staffNames: Map<String, String> = emptyMap(),
    val pendingDelete: ScheduleException? = null,
    val isSaving: Boolean = false,
    val error: String? = null,
)

/**
 * İzin ve istisnalar (A7.3) — iOS `ScheduleExceptionListView` paritesi; isteğe bağlı olarak
 * tek bir personele daraltılmış.
 *
 * **iOS'tan sapma — `from` gönderilmiyor.** Sunucu `from`/`to`'yu yalnız `startsAt` ile
 * karşılaştırıyor: geçen ay başlamış ve hâlâ süren bir izin ya da haftalık bir tekrar
 * `from = bugün` ile hiç gelmiyor (iOS'ta görünmüyor). Burada yalnız `to` gönderilip "hâlâ
 * geçerli olanlar" istemcide süzülüyor ([stillRelevant]). Liste zarfı sayfasız; şube başına
 * istisna sayısı bunu taşır.
 */
class ScheduleExceptionListViewModel(
    private val scheduling: SchedulingService,
    private val staff: StaffService,
    private val branchId: String,
    private val staffProfileId: String?,
    private val clock: BranchClock,
    private val now: () -> Instant = Instant::now,
) : ViewModel() {
    private val _state = MutableStateFlow(ScheduleExceptionListUiState())
    val state: StateFlow<ScheduleExceptionListUiState> = _state.asStateFlow()

    fun load() {
        val range = _state.value.range
        if (_state.value.rows !is Loadable.Loaded) _state.update { it.copy(rows = Loadable.Loading) }
        viewModelScope.launch {
            val today = clock.startOfDay(now())
            val result =
                Loadable.of {
                    coroutineScope {
                        val names = async { staff.list().associate { it.id to it.userFullName } }
                        val rows =
                            async {
                                scheduling.exceptions(
                                    ScheduleExceptionQuery(
                                        branchId = branchId,
                                        staffProfileId = staffProfileId,
                                        to = clock.adding(range.days, today),
                                    ),
                                )
                            }
                        names.await() to rows.await().filter { stillRelevant(it, today) }
                    }
                }
            _state.update {
                it.copy(
                    rows = result.map { (_, rows) -> rows },
                    staffNames = result.valueOrNull?.first ?: it.staffNames,
                )
            }
        }
    }

    fun setRange(range: ExceptionRange) {
        if (range == _state.value.range) return
        _state.update { it.copy(range = range, rows = Loadable.Loading) }
        load()
    }

    fun askDelete(exception: ScheduleException) = _state.update { it.copy(pendingDelete = exception) }

    fun cancelDelete() = _state.update { it.copy(pendingDelete = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    /** `DELETE` 204 döner; liste sunucudan yeniden çekilir (iOS gibi). Hata YUTULMAZ. */
    fun confirmDelete() {
        val target = _state.value.pendingDelete ?: return
        if (_state.value.isSaving) return
        _state.update { it.copy(pendingDelete = null, isSaving = true, error = null) }
        viewModelScope.launch {
            try {
                scheduling.deleteException(target.id)
                _state.update { it.copy(isSaving = false) }
                load()
            } catch (error: ApiError) {
                _state.update { it.copy(isSaving = false, error = error.displayMessage) }
            }
        }
    }

    companion object {
        /** Bitmemiş tek seferlik istisna ya da tekrar bitişi gelmemiş haftalık istisna. */
        fun stillRelevant(
            exception: ScheduleException,
            today: Instant,
        ): Boolean =
            when (exception.recurrenceType) {
                ScheduleRecurrence.Weekly -> (exception.recurrenceUntil ?: exception.endsAt) >= today
                else -> exception.endsAt >= today
            }

        fun factory(
            container: ServiceContainer,
            branchId: String,
            staffProfileId: String?,
            timezone: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ScheduleExceptionListViewModel(
                        container.scheduling,
                        container.staff,
                        branchId,
                        staffProfileId,
                        BranchClock(timezone),
                    ) as T
            }
    }
}

data class ScheduleExceptionEditorUiState(
    val draft: ScheduleExceptionDraft,
    /** Ön seçimli personelde yüklenmez (`Loaded(emptyList())`). */
    val staff: Loadable<List<StaffProfile>> = Loadable.Loading,
    val isSaving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val saved: ScheduleException? = null,
)

/** Yeni istisna (A7.3) — yalnız oluşturma. Personel ön seçili değilse AKTİF personelden seçtirilir. */
class ScheduleExceptionEditorViewModel(
    private val scheduling: SchedulingService,
    private val staffService: StaffService,
    private val branchId: String,
    private val presetStaffProfileId: String?,
    clock: BranchClock,
) : ViewModel() {
    private val _state =
        MutableStateFlow(
            ScheduleExceptionEditorUiState(draft = ScheduleExceptionDraft.initial(clock, presetStaffProfileId)),
        )
    val state: StateFlow<ScheduleExceptionEditorUiState> = _state.asStateFlow()

    val needsStaffPicker: Boolean get() = presetStaffProfileId == null

    fun load() {
        if (_state.value.staff is Loadable.Loaded) return
        if (!needsStaffPicker) {
            _state.update { it.copy(staff = Loadable.Loaded(emptyList())) }
            return
        }
        viewModelScope.launch {
            val result = Loadable.of { staffService.list().filter { it.isActive } }
            _state.update { it.copy(staff = result) }
        }
    }

    fun update(transform: (ScheduleExceptionDraft) -> ScheduleExceptionDraft) =
        _state.update { it.copy(draft = transform(it.draft), error = null, fieldErrors = emptyMap()) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun save() {
        val current = _state.value
        val input = current.draft.input(branchId) ?: return
        if (current.isSaving) return
        _state.update { it.copy(isSaving = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                val saved = scheduling.createException(input)
                _state.update { it.copy(isSaving = false, saved = saved) }
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
            branchId: String,
            presetStaffProfileId: String?,
            timezone: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ScheduleExceptionEditorViewModel(
                        container.scheduling,
                        container.staff,
                        branchId,
                        presetStaffProfileId,
                        BranchClock(timezone),
                    ) as T
            }
    }
}

private inline fun <T, R> Loadable<T>.map(transform: (T) -> R): Loadable<R> =
    when (this) {
        is Loadable.Loaded -> Loadable.Loaded(transform(value))
        is Loadable.Failed -> this
        Loadable.Loading -> Loadable.Loading
    }
