package com.klinara.android.features.dashboard

import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.booking.CalendarDayQuery
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.booking.CalendarResponse
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.contracts.RolePermissions
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.reports.MockReportsService
import com.klinara.android.services.reports.OccupancyGrouping
import com.klinara.android.services.reports.OccupancyReport
import com.klinara.android.services.reports.OccupancyRow
import com.klinara.android.services.reports.OccupancyTotals
import com.klinara.android.services.reports.ReportPage
import com.klinara.android.services.reports.ReportPeriodEcho
import com.klinara.android.services.reports.ReportQuery
import com.klinara.android.services.reports.ReportsService
import com.klinara.android.services.reports.RevenueGrouping
import com.klinara.android.services.reports.RevenueReport
import com.klinara.android.services.reports.RevenueRow
import com.klinara.android.services.reports.RevenueTotals
import com.klinara.android.services.reports.StaffPerformanceReport
import com.klinara.android.services.reports.StaffPerformanceRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class DashboardTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private val now = Instant.parse("2026-09-14T09:00:00Z")
    private val kadikoy = BranchSummary(id = "b1", name = "Kadıköy")
    private val nisantasi = BranchSummary(id = "b2", name = "Nişantaşı")
    private val closed = BranchSummary(id = "b3", name = "Kapalı", isActive = false)

    private fun entry(
        id: String,
        startsAt: String,
        status: AppointmentStatus,
    ) = CalendarEntry(
        id = id,
        branchId = "b1",
        customerId = "c",
        customerName = id,
        status = status,
        startsAt = Instant.parse(startsAt),
        endsAt = Instant.parse(startsAt).plusSeconds(1800),
    )

    private val period = ReportPeriodEcho("2026-09-01", "2026-10-01")

    private val occupancy =
        OccupancyReport(
            period = period,
            totals = OccupancyTotals(occupancyRate = 61.0),
            data = listOf(OccupancyRow(groupId = "b1", groupLabel = "Kadıköy", occupancyRate = 72.0)),
            delta = mapOf("occupancyRate" to 12.0),
        )

    private val revenue =
        RevenueReport(
            period = period,
            totals = RevenueTotals(accruedMinor = 150_000),
            data = listOf(RevenueRow(groupId = "b2", groupLabel = "Nişantaşı", accruedMinor = 150_000)),
        )

    // --- Saf birleştirme ---

    @Test
    @DisplayName("Gün özeti: slot kaplayan, tamamlanan ve sıradakiler (başlamamış, tamamlanmamış)")
    fun summarizeDay() {
        val day =
            DashboardSummaries.summarizeDay(
                listOf(
                    entry("done", "2026-09-14T06:00:00Z", AppointmentStatus.Completed),
                    entry("later", "2026-09-14T11:00:00Z", AppointmentStatus.Scheduled),
                    entry("soon", "2026-09-14T10:00:00Z", AppointmentStatus.Confirmed),
                    entry("gone", "2026-09-14T12:00:00Z", AppointmentStatus.Cancelled),
                    entry("past", "2026-09-14T07:00:00Z", AppointmentStatus.Scheduled),
                ),
                now,
            )
        assertEquals(5, day.total)
        assertEquals(4, day.active)
        assertEquals(1, day.completed)
        assertEquals(listOf("soon", "later"), day.upcoming.map { it.id })
        assertEquals(2, day.pending)
    }

    @Test
    @DisplayName("Önizleme sınırlı ama toplam korunuyor: 8 bekleyen randevu → 5 satır, 'Tümünü gör' için 8")
    fun previewIsBoundedButCountIsKept() {
        val entries = (1..8).map { entry("e$it", "2026-09-14T1$it:00:00Z", AppointmentStatus.Scheduled) }
        val day = DashboardSummaries.summarizeDay(entries, Instant.parse("2026-09-14T08:00:00Z"))
        assertEquals(DashboardSummaries.PREVIEW_LIMIT, day.upcoming.size)
        assertEquals(8, day.pending)

        val days = mapOf("b1" to (entries to "Europe/Istanbul"))
        val summaries = DashboardSummaries.merge(listOf(kadikoy), days, null, null, null, now)
        assertEquals(DashboardSummaries.PREVIEW_LIMIT, DashboardSummaries.upcoming(summaries).size)
    }

    @Test
    @DisplayName("Rapor geldiyse satırı olmayan şube SIFIR, rapor hiç yoksa NULL; oran sunucu toplamından")
    fun mergeAndTotals() {
        val summaries =
            DashboardSummaries.merge(
                branches = listOf(kadikoy, nisantasi),
                days =
                    mapOf(
                        "b1" to
                            (listOf(entry("soon", "2026-09-14T10:00:00Z", AppointmentStatus.Scheduled)) to
                                "Europe/Istanbul"),
                    ),
                occupancy = occupancy,
                revenue = revenue,
                noShow = null,
                now = now,
            )
        val (k, n) = summaries
        assertEquals(72.0, k.occupancyRate)
        assertEquals(0.0, n.occupancyRate)
        assertEquals(0L, k.revenueMinor)
        assertEquals(150_000L, n.revenueMinor)
        assertNull(k.noShowRate)
        // Takvimi alınamayan şube "0 randevu" değil, bilinmiyor.
        assertNull(n.today)

        val totals = DashboardSummaries.totals(summaries, occupancy, revenue, null)
        assertEquals(1, totals.todayTotal)
        assertEquals(61.0, totals.occupancyRate)
        assertNull(totals.noShowRate)

        assertEquals(
            listOf(BranchMetric.Today, BranchMetric.Occupancy, BranchMetric.Revenue),
            DashboardSummaries.availableMetrics(summaries),
        )
        assertEquals(emptyList<BranchMetric>(), DashboardSummaries.availableMetrics(emptyList()))
    }

    @Test
    @DisplayName("Personel cirosu: ciroya, eşitlikte işlem sayısına, o da eşitse ada göre; boş satır yok")
    fun topStaff() {
        val report =
            StaffPerformanceReport(
                period = period,
                data =
                    listOf(
                        StaffPerformanceRow("p1", "Elif", completedServices = 4, revenueMinor = 90_000),
                        StaffPerformanceRow("p2", "Zeynep", completedServices = 7, revenueMinor = 160_000),
                        StaffPerformanceRow("p3", "Can", completedServices = 5, revenueMinor = 90_000),
                        // Planı var, bu ay hiçbir şey yapmamış: listeyi "₺0,00 · 0 işlem" ile doldurmaz.
                        StaffPerformanceRow("p4", "Boş", completedServices = 0, revenueMinor = 0),
                    ),
            )
        assertEquals(listOf("Zeynep", "Can", "Elif"), DashboardSummaries.topStaffByRevenue(report).map { it.staffName })
        assertEquals(emptyList<StaffPerformanceRow>(), DashboardSummaries.topStaffByRevenue(null))
    }

    @Test
    @DisplayName("Erişim web ile aynı: resepsiyon ciro görmez, uygulayıcı yalnız takvim + kendi cirosu")
    fun access() {
        val receptionist = DashboardAccess.of(RolePermissions.forRole("receptionist")::contains)
        assertTrue(receptionist.calendar)
        assertTrue(receptionist.occupancy)
        assertFalse(receptionist.revenue)

        val practitioner = DashboardAccess.of(RolePermissions.forRole("practitioner")::contains)
        assertTrue(practitioner.calendar)
        assertFalse(practitioner.occupancy)
        assertFalse(practitioner.revenue)
        assertTrue(practitioner.staff)
    }

    @Test
    @DisplayName("Özet şeridi web KPI'larıyla aynı: izne göre kart, kaynağı düşen kart '—' ile yerinde")
    fun statStrip() {
        val manager = DashboardAccess.of(RolePermissions.forRole("manager")::contains)
        assertEquals(
            listOf("Bugünkü randevu", "Bu ay doluluk", "Bu ay ciro", "Bu ay gelmeme"),
            dashboardStats(null, manager).map { it.label },
        )
        // Yüklenmeden önce değer yok ama kartlar var (yer tutucu).
        assertTrue(dashboardStats(null, manager).all { it.value == null })

        val revenueOnly = DashboardAccess.of(setOf(Permissions.REPORT_REVENUE_READ)::contains)
        assertEquals(listOf("Bu ay ciro"), dashboardStats(null, revenueOnly).map { it.label })
    }

    // --- ViewModel ---

    private class RecordingBooking(
        delegate: BookingService,
    ) : BookingService by delegate {
        val days = mutableListOf<CalendarDayQuery>()

        override suspend fun calendarDay(query: CalendarDayQuery): CalendarResponse {
            days += query
            return CalendarResponse(
                branchId = query.branchId,
                timezone = "Europe/Istanbul",
                from = Instant.EPOCH,
                to = Instant.EPOCH,
            )
        }
    }

    private class RecordingReports(
        delegate: ReportsService,
        private val failRevenue: Boolean = false,
    ) : ReportsService by delegate {
        val calls = mutableListOf<String>()

        override suspend fun occupancy(
            query: ReportQuery,
            groupBy: OccupancyGrouping,
            page: ReportPage,
        ): OccupancyReport {
            calls += "occupancy:${groupBy.wire}:${query.compareToPrevious}"
            return OccupancyReport(period = ReportPeriodEcho("", ""), totals = OccupancyTotals(occupancyRate = 64.0))
        }

        override suspend fun revenue(
            query: ReportQuery,
            groupBy: RevenueGrouping,
            page: ReportPage,
        ): RevenueReport {
            calls += "revenue:${groupBy.wire}"
            if (failRevenue) throw ApiError.Network()
            return RevenueReport(period = ReportPeriodEcho("", ""), totals = RevenueTotals(accruedMinor = 1))
        }
    }

    private fun reports(
        role: String,
        failRevenue: Boolean = false,
    ) = RecordingReports(
        MockReportsService(latencyEnabled = false, permissions = { RolePermissions.forRole(role) }, now = { now }),
        failRevenue,
    )

    private fun booking() = RecordingBooking(MockBookingService(latencyEnabled = false))

    @Test
    @DisplayName("Takvim şube başına ŞUBE GÜNÜYLE isteniyor; pasif şubeye istek yok; raporlar şube kırılımlı")
    fun loadsPerBranch() =
        runTest(dispatcher) {
            val booking = booking()
            val reports = reports("manager")
            val access = DashboardAccess.of(RolePermissions.forRole("manager")::contains)
            val model = DashboardViewModel(booking, reports, listOf(kadikoy, nisantasi, closed), access) { now }
            advanceUntilIdle()

            assertEquals(listOf("b1", "b2"), booking.days.map { it.branchId })
            assertEquals("2026-09-14", booking.days.first().date)
            assertTrue("occupancy:branch:true" in reports.calls)
            assertTrue("revenue:branch" in reports.calls)
            assertEquals(64.0, model.state.value.data?.totals?.occupancyRate)
            assertFalse(model.state.value.isLoading)
        }

    @Test
    @DisplayName("İzni olmayan kaynağa istek atılmıyor: yalnız ciro izni varsa takvim ve doluluk yok")
    fun gatesRequests() =
        runTest(dispatcher) {
            val booking = booking()
            val reports = reports("owner")
            val access = DashboardAccess.of(setOf(Permissions.REPORT_REVENUE_READ)::contains)
            DashboardViewModel(booking, reports, listOf(kadikoy), access) { now }
            advanceUntilIdle()

            assertTrue(booking.days.isEmpty())
            assertFalse(reports.calls.any { it.startsWith("occupancy") })
            assertTrue(reports.calls.any { it.startsWith("revenue") })
        }

    @Test
    @DisplayName("Tek bir rapor düşerse yalnız rapor uyarısı; diğer bölümler dolu")
    fun partialFailure() =
        runTest(dispatcher) {
            val access = DashboardAccess.of(RolePermissions.forRole("manager")::contains)
            val model =
                DashboardViewModel(booking(), reports("manager", failRevenue = true), listOf(kadikoy), access) { now }
            advanceUntilIdle()

            val data = model.state.value.data!!
            assertNotNull(data.reportsError)
            assertNull(data.calendarError)
            assertNull(data.totals.revenueMinor)
            assertEquals(64.0, data.totals.occupancyRate)
            assertEquals(0, data.totals.todayTotal)
        }
}
