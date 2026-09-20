package com.klinara.android.features.calendar

import androidx.annotation.DrawableRes
import androidx.lifecycle.ViewModel
import com.klinara.android.R
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.booking.CalendarDayQuery
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.booking.CalendarResponse
import com.klinara.android.services.booking.CalendarWeekQuery
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.networking.ProblemDetails
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

/** Takvimin üç görünümü. Sıra ekranda görünen sıradır. */
enum class CalendarMode(
    val turkishName: String,
    @param:DrawableRes val iconRes: Int,
) {
    Agenda("Ajanda", R.drawable.ic_mode_agenda),
    Day("Gün", R.drawable.ic_mode_day),
    Week("Hafta", R.drawable.ic_mode_week),
    ;

    /** İleri/geri okları bu kadar atlar: ajanda ve gün bir gün, hafta yedi gün. */
    val stride: Long get() = if (this == Week) DAYS_PER_WEEK else 1L

    val previousLabel: String get() = if (this == Week) "Önceki hafta" else "Önceki gün"

    val nextLabel: String get() = if (this == Week) "Sonraki hafta" else "Sonraki gün"

    private companion object {
        const val DAYS_PER_WEEK = 7L
    }
}

data class CalendarUiState(
    val mode: CalendarMode = CalendarMode.Agenda,
    val selectedDate: Instant,
    /** null = şube geneli. Sunucuya `staffProfileId` olarak gider. */
    val staffFilter: String? = null,
    val calendar: Loadable<CalendarResponse> = Loadable.Loading,
    val staff: Loadable<List<StaffProfile>> = Loadable.Loading,
    /** Eski veri ekrandayken yenisi isteniyor: gövde sönük çizilir, dokunulamaz. */
    val isRefreshing: Boolean = false,
) {
    private val entries: List<CalendarEntry> get() = calendar.valueOrNull?.appointments.orEmpty()

    /** Ajandanın üst kartı: hâlâ yaşayan randevular. */
    val activeEntries: List<CalendarEntry>
        get() = entries.filterNot { it.status.isTerminal }.sortedBy { it.startsAt }

    /**
     * İptal ve gelmedi — ayrı kartta ama GİZLENMEZ. Gelmeyen bir müşteriyi listeden
     * silmek, "aramadım mı?" sorusunun cevabını da silmek olurdu.
     */
    val terminalEntries: List<CalendarEntry>
        get() = entries.filter { it.status.isTerminal }.sortedBy { it.startsAt }

    /** `localDay` → saat → randevu sayısı. */
    val densityByDay: Map<String, Map<Int, Int>>
        get() =
            calendar.valueOrNull
                ?.density
                .orEmpty()
                .groupBy { it.localDay }
                .mapValues { (_, buckets) -> buckets.associate { it.localHour to it.appointmentCount } }

    /** Isı ölçeğinin üst ucu. 0 ise yoğunluk hiç çizilmez. */
    val densityPeak: Int
        get() = calendar.valueOrNull?.density.orEmpty().maxOfOrNull { it.appointmentCount } ?: 0

    /**
     * Yoğunluk ısı haritasının kapsam notu.
     *
     * Sunucu yoğunluğu **personel filtresine göre daraltmıyor**
     * (`calendar.repository.ts:loadDensity`). Filtre açıkken ısı haritası hâlâ şube
     * genelini gösteriyor; bunu söylememek, kullanıcının seçtiği personelin yoğunluğuna
     * bakıyormuş gibi hissetmesine yol açardı — ve o yanlış izlenim ekranda hiçbir
     * yerden düzeltilemezdi.
     */
    val densityNote: String?
        get() = "şube geneli".takeIf { staffFilter != null }

    val activeStaff: List<StaffProfile>
        get() = staff.valueOrNull.orEmpty().filter { it.isActive }

    fun staffColor(staffProfileId: String?): String? =
        staff.valueOrNull?.firstOrNull { it.id == staffProfileId }?.calendarColor
}

/**
 * Takvimin durumu.
 *
 * **Gün başına önbellek YOK** (iOS'ta da yok): düne dönmek yeniden ister. Bir randevu
 * takviminde bayat veri, olmayan bir boşluğa randevu vermek demektir; ikinci bir
 * doğruluk kaynağı tutmamanın bedeli bir isteklik gecikmedir.
 *
 * `SavedStateHandle` KULLANILMAZ — A1.1 ve A2.1'deki gerekçenin aynısı, üstüne §7.9:
 * seçili tarih ve mod ekranın kendi `rememberSaveable`'ında yaşar, **randevu verisi
 * hiçbir yerde diske yazılmaz**.
 */
class CalendarViewModel(
    private val booking: BookingService,
    private val staff: StaffService,
    private val clock: BranchClock,
    today: Instant = Instant.now(),
) : ViewModel() {
    private val _state = MutableStateFlow(CalendarUiState(selectedDate = clock.startOfDay(today)))
    val state: StateFlow<CalendarUiState> = _state.asStateFlow()

    /**
     * Yeniden yükleme anahtarı.
     *
     * `mode` doğrudan anahtarın parçası DEĞİL, türetilmiş [scope] öyle: ajanda ile gün
     * aynı günü ister, dolayısıyla aralarında geçiş yapmak istek atmaz; hafta modunda
     * gün değiştirmek de aynı haftada kaldığı sürece atmaz. iOS `LoadKey` paritesi.
     */
    data class LoadKey(
        val branchId: String?,
        val scope: String,
        val staffProfileId: String?,
        val branchGeneration: Int,
    )

    fun loadKey(
        branchId: String?,
        branchGeneration: Int = 0,
    ): LoadKey {
        val current = _state.value
        val scope =
            when (current.mode) {
                CalendarMode.Week -> "w" + clock.localDateString(clock.startOfWeek(current.selectedDate))
                CalendarMode.Agenda, CalendarMode.Day -> "d" + clock.localDateString(current.selectedDate)
            }
        return LoadKey(branchId, scope, current.staffFilter, branchGeneration)
    }

    fun load(branchId: String?) {
        if (branchId == null) {
            // Şube seçilmeden takvim ÇAĞRILMAZ: sunucu 400 verirdi ve kullanıcı
            // "bir şeyler ters gitti" görürdü. Neyin eksik olduğunu söylemek daha dürüst.
            _state.update { it.copy(calendar = Loadable.failed(BRANCH_MISSING)) }
            return
        }
        // Önceki veri varsa yerinde KALIR: gün/hafta değişiminde gövdeyi "yükleniyor"
        // metniyle değiştirmek her dokunuşta ekranı söndürüp yakıyordu. Yalnız ilk
        // yüklemede (ya da hatadan sonra) Loading gösterilir.
        _state.update {
            if (it.calendar is Loadable.Loaded) it.copy(isRefreshing = true) else it.copy(calendar = Loadable.Loading)
        }
        viewModelScope.launch {
            val current = _state.value
            val next =
                Loadable.of {
                    when (current.mode) {
                        CalendarMode.Week ->
                            booking.calendarWeek(
                                CalendarWeekQuery(
                                    branchId = branchId,
                                    weekStart = clock.localDateString(clock.startOfWeek(current.selectedDate)),
                                    staffProfileId = current.staffFilter,
                                ),
                            )

                        CalendarMode.Agenda, CalendarMode.Day ->
                            booking.calendarDay(
                                CalendarDayQuery(
                                    branchId = branchId,
                                    date = clock.localDateString(current.selectedDate),
                                    staffProfileId = current.staffFilter,
                                ),
                            )
                    }
                }
            _state.update { it.copy(calendar = next, isRefreshing = false) }
        }
    }

    /**
     * Personel listesi takvimden BAĞIMSIZ yüklenir ve bağımsız düşer.
     *
     * Personel gelmezse filtre çipleri ve blok renkleri kaybolur ama randevular çizilir.
     * Tek bir `isLoading` bayrağı, ikinci dereceden bir listenin yokluğu yüzünden günün
     * tamamını gizlerdi (A2.2'de profil için verilen kararın aynısı).
     */
    fun loadStaff() {
        if (_state.value.staff is Loadable.Loaded) return
        _state.update { it.copy(staff = Loadable.Loading) }
        viewModelScope.launch {
            val next = Loadable.of { staff.list() }
            _state.update { it.copy(staff = next) }
        }
    }

    fun select(date: Instant) = _state.update { it.copy(selectedDate = clock.startOfDay(date)) }

    fun setMode(mode: CalendarMode) = _state.update { it.copy(mode = mode) }

    /** İleri/geri: adım genişliği moda bağlı. */
    fun step(direction: Long) =
        _state.update {
            it.copy(selectedDate = clock.adding(direction * it.mode.stride, it.selectedDate))
        }

    fun goToToday(now: Instant = Instant.now()) = _state.update { it.copy(selectedDate = clock.startOfDay(now)) }

    /** Aynı personele tekrar dokunmak filtreyi TEMİZLER — çipin kendisi bir anahtardır. */
    fun toggleStaffFilter(staffProfileId: String?) =
        _state.update {
            it.copy(staffFilter = if (it.staffFilter == staffProfileId) null else staffProfileId)
        }

    companion object {
        private val BRANCH_MISSING =
            com.klinara.android.services.networking.ApiError.Problem(
                ProblemDetails(
                    code = ApiErrorCode.VALIDATION_FAILED,
                    title = "Şube seçilmedi",
                    detail = "Takvimi görmek için önce bir şube seçin.",
                    status = HTTP_BAD_REQUEST,
                ),
            )

        private const val HTTP_BAD_REQUEST = 400

        fun factory(
            container: ServiceContainer,
            clock: BranchClock,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CalendarViewModel(container.booking, container.staff, clock) as T
            }
    }
}
