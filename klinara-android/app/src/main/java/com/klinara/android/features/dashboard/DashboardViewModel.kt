package com.klinara.android.features.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.booking.CalendarDayQuery
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.reports.NoShowGrouping
import com.klinara.android.services.reports.OccupancyGrouping
import com.klinara.android.services.reports.ReportPeriod
import com.klinara.android.services.reports.ReportQuery
import com.klinara.android.services.reports.ReportsService
import com.klinara.android.services.reports.RevenueGrouping
import com.klinara.android.services.reports.StaffPerformanceReport
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant

/** Yüklenmiş genel bakış. Bölüm başına hata; `null` = sorun yok ya da istek atılmadı. */
data class DashboardData(
    val summaries: List<BranchDashboardSummary>,
    val totals: DashboardTotals,
    val occupancyDelta: Double?,
    val revenueDelta: Double?,
    val noShowDelta: Double?,
    val staffPerformance: StaffPerformanceReport?,
    val calendarError: String?,
    val reportsError: String?,
)

data class DashboardUiState(
    val isLoading: Boolean = true,
    val data: DashboardData? = null,
)

/**
 * Genel bakışın verisi — web `use-dashboard.ts` paritesi.
 *
 * - İzni olmayan kaynağa istek HİÇ atılmıyor ([DashboardAccess]). 403'ü yakalayıp bölümü gizlemek
 *   aynı ekranı çizerdi, ama her açılışta denetim günlüğünü kırmızıya boyayarak.
 * - Kaynaklar AYRI düşebiliyor: tek bir şubenin günü ya da tek bir rapor düşerse yalnız o bölüm
 *   uyarı gösteriyor, geri kalanı çiziliyor.
 * - Yoklama YOK. Takvim canlı bir çalışma ekranı; burası bir bakış, "Yenile" yeterli.
 *
 * `calendar/day` şube başına, sorgu parametresindeki şubeyle atılıyor; `X-Branch-Id` seçili
 * şubeden gidiyor ve sunucu sorgudaki şubeye erişimi ayrıca doğruluyor. Gün ŞUBENİN saat
 * diliminde: İstanbul şubesinin "bugün"ü başka dilimden bakan yönetici için de İstanbul günü.
 */
class DashboardViewModel(
    private val booking: BookingService,
    private val reports: ReportsService,
    private val branches: List<BranchSummary>,
    private val access: DashboardAccess,
    private val now: () -> Instant = Instant::now,
) : ViewModel() {
    private val _state = MutableStateFlow(DashboardUiState())
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

    private var job: Job? = null

    init {
        reload()
    }

    fun reload() {
        job?.cancel()
        _state.value = DashboardUiState(isLoading = true, data = _state.value.data)
        job = viewModelScope.launch { _state.value = DashboardUiState(isLoading = false, data = load()) }
    }

    private suspend fun load(): DashboardData =
        coroutineScope {
            val at = now()
            val active = DashboardSummaries.activeBranches(branches)

            val days: List<Deferred<Result<Pair<String, Pair<List<CalendarEntry>, String>>>>> =
                if (access.calendar) {
                    active.map { branch ->
                        async {
                            attempt {
                                val date = BranchClock(branch.timezone).localDateString(at)
                                val response = booking.calendarDay(CalendarDayQuery(branchId = branch.id, date = date))
                                branch.id to (response.appointments to response.timezone)
                            }
                        }
                    }
                } else {
                    emptyList()
                }

            // Ay sınırı ilk şubenin saatinde — web de tek bir "bu ay" aralığı gönderiyor.
            val clock = BranchClock(active.firstOrNull()?.timezone)
            val start = clock.startOfMonth(at)
            val period = ReportPeriod(start, clock.addingMonths(1, start))
            // Şube verilmiyor: sunucu "erişebildiğin tüm şubeler" için hesaplayıp satırlara bölüyor.
            val compared = ReportQuery(period = period, branchId = null, compareToPrevious = true)
            val plain = ReportQuery(period = period, branchId = null)

            val occupancy =
                async { optional(access.occupancy) { reports.occupancy(compared, OccupancyGrouping.Branch) } }
            val noShow = async { optional(access.occupancy) { reports.noShow(compared, NoShowGrouping.Branch) } }
            val revenue = async { optional(access.revenue) { reports.revenue(compared, RevenueGrouping.Branch) } }
            // Personel kırılımı karşılaştırma almıyor; yalnız dönem.
            val staff = async { optional(access.staff) { reports.staffPerformance(plain) } }

            val dayResults = days.map { it.await() }
            val dayMap = dayResults.mapNotNull { it.getOrNull() }.toMap()
            val calendarError = dayResults.firstNotNullOfOrNull { it.exceptionOrNull() }?.let(::message)

            val reportResults = listOf(occupancy.await(), noShow.await(), revenue.await(), staff.await())
            val reportsError = reportResults.firstNotNullOfOrNull { it.exceptionOrNull() }?.let(::message)

            val occupancyReport = occupancy.await().getOrNull()
            val noShowReport = noShow.await().getOrNull()
            val revenueReport = revenue.await().getOrNull()

            val summaries =
                DashboardSummaries.merge(active, dayMap, occupancyReport, revenueReport, noShowReport, at)
            DashboardData(
                summaries = summaries,
                totals = DashboardSummaries.totals(summaries, occupancyReport, revenueReport, noShowReport),
                occupancyDelta = occupancyReport?.delta?.get("occupancyRate"),
                revenueDelta = revenueReport?.delta?.get("accruedMinor"),
                noShowDelta = noShowReport?.delta?.get("noShowRate"),
                staffPerformance = staff.await().getOrNull(),
                calendarError = calendarError,
                reportsError = reportsError,
            )
        }

    /** Yalnız `ApiError` bölüme düşer; programlama hataları yukarı geçer (gizlenmez). */
    private suspend fun <T> attempt(block: suspend () -> T): Result<T> =
        try {
            Result.success(block())
        } catch (error: ApiError) {
            Result.failure(error)
        }

    private suspend fun <T> optional(
        allowed: Boolean,
        block: suspend () -> T,
    ): Result<T?> = if (allowed) attempt(block) else Result.success(null)

    private fun message(error: Throwable): String = (error as? ApiError)?.displayMessage ?: "Beklenmeyen hata"

    companion object {
        fun factory(
            container: ServiceContainer,
            branches: List<BranchSummary>,
            access: DashboardAccess,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    DashboardViewModel(container.booking, container.reports, branches, access) as T
            }
    }
}
