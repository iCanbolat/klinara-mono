package com.klinara.android.features.reports

import com.klinara.android.services.contracts.RolePermissions
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.networking.PageInfo
import com.klinara.android.services.reports.MockReportsService
import com.klinara.android.services.reports.OccupancyGrouping
import com.klinara.android.services.reports.OccupancyReport
import com.klinara.android.services.reports.OccupancyRow
import com.klinara.android.services.reports.OccupancyTotals
import com.klinara.android.services.reports.ReportKind
import com.klinara.android.services.reports.ReportPage
import com.klinara.android.services.reports.ReportPeriodEcho
import com.klinara.android.services.reports.ReportQuery
import com.klinara.android.services.reports.ReportScope
import com.klinara.android.services.reports.ReportsService
import kotlinx.coroutines.CompletableDeferred
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
class ReportsViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private val clock = BranchClock("Europe/Istanbul")
    private val now = Instant.parse("2026-09-12T09:00:00Z")

    private fun subject(service: ReportsService = mock()) = ReportsViewModel(service, clock, branchId = null, now = now)

    private fun mock(role: String = "manager") =
        MockReportsService(latencyEnabled = false, permissions = { RolePermissions.forRole(role) }, now = { now })

    /**
     * 120 satırlık doluluk raporu, imleç = sıra numarası. Sonraki sayfa isteği [gate] açılana
     * kadar bekler (iptal testi) ya da [failNextPage] ile düşer.
     */
    private class PagedOccupancy(
        private val inner: ReportsService,
    ) : ReportsService by inner {
        var gate: CompletableDeferred<Unit>? = null
        var failNextPage = false
        val requested = mutableListOf<ReportPage>()

        override suspend fun occupancy(
            query: ReportQuery,
            groupBy: OccupancyGrouping,
            page: ReportPage,
        ): OccupancyReport {
            requested += page
            if (page.cursor != null) {
                gate?.await()
                if (failNextPage) throw ApiError.Network()
            }
            val start = page.cursor?.toInt() ?: 0
            val size = page.limit ?: ROWS
            val rows = (start until minOf(start + size, ROWS)).map { OccupancyRow(null, "gün-$it", 30, 540, 5.56) }
            val end = start + rows.size
            return OccupancyReport(
                scope = ReportScope.All,
                period = ReportPeriodEcho(query.period.from.toString(), query.period.to.toString()),
                totals = OccupancyTotals(ROWS * 30, ROWS * 540, 5.56),
                data = rows,
                pageInfo = PageInfo(nextCursor = end.toString().takeIf { end < ROWS }, hasMore = end < ROWS),
            )
        }

        companion object {
            const val ROWS = 120
        }
    }

    @Test
    @DisplayName("Dönem yarı açık; etiket son günü yazıyor; karşılaştırma penceresi AYNI UZUNLUKTA")
    fun periodAndPreviousWindow() {
        val viewModel = subject()
        val state = viewModel.state.value

        assertEquals(Instant.parse("2026-08-31T21:00:00Z"), state.periodStart)
        assertEquals(Instant.parse("2026-09-30T21:00:00Z"), state.periodEnd)
        assertEquals("1 Eylül 2026 – 30 Eylül 2026", viewModel.label(state.period))
        // 30 günlük eylülün öncesi "ağustos" DEĞİL: 2 Ağustos'tan başlayan 30 gün.
        assertEquals("2 Ağustos 2026 – 31 Ağustos 2026", viewModel.label(state.previousPeriod))
    }

    @Test
    @DisplayName("İlk sayfa 50 satır; sonraki sayfa satır EKLİYOR, toplamlar ilk sayfadaki kalıyor")
    fun loadMoreAppendsAndKeepsTotals() =
        runTest {
            val service = PagedOccupancy(mock())
            val viewModel = subject(service)

            viewModel.load(ReportKind.Occupancy)
            advanceUntilIdle()
            val first = viewModel.state.value.occupancy.valueOrNull!!
            assertEquals(ReportsViewModel.PAGE_SIZE, first.data.size)
            assertTrue(viewModel.state.value.canLoadMore(ReportKind.Occupancy))

            viewModel.loadMore(ReportKind.Occupancy)
            viewModel.loadMore(ReportKind.Occupancy) // yoldayken ikinci istek başlamaz
            advanceUntilIdle()
            viewModel.loadMore(ReportKind.Occupancy)
            advanceUntilIdle()

            val all = viewModel.state.value.occupancy.valueOrNull!!
            assertEquals(PagedOccupancy.ROWS, all.data.size)
            assertEquals((0 until PagedOccupancy.ROWS).map { "gün-$it" }, all.data.map { it.groupLabel })
            assertEquals(first.totals, all.totals)
            assertFalse(viewModel.state.value.canLoadMore(ReportKind.Occupancy))
            assertEquals(3, service.requested.size)
            assertTrue(service.requested.all { it.limit == ReportsViewModel.PAGE_SIZE })
        }

    @Test
    @DisplayName("Sayfa hatası eldeki satırları düşürmüyor; düğme yeniden denemeye açık kalıyor")
    fun pageFailureKeepsRows() =
        runTest {
            val service = PagedOccupancy(mock()).apply { failNextPage = true }
            val viewModel = subject(service)
            viewModel.load(ReportKind.Occupancy)
            advanceUntilIdle()

            viewModel.loadMore(ReportKind.Occupancy)
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(ReportsViewModel.PAGE_SIZE, state.occupancy.valueOrNull!!.data.size)
            assertTrue(state.canLoadMore(ReportKind.Occupancy))
        }

    @Test
    @DisplayName("Dönem değişip rapor yeniden yüklenirse yoldaki ESKİ sayfa yeni rapora eklenmiyor")
    fun reloadCancelsStalePage() =
        runTest {
            val service = PagedOccupancy(mock()).apply { gate = CompletableDeferred() }
            val viewModel = subject(service)
            viewModel.load(ReportKind.Occupancy)
            advanceUntilIdle()
            viewModel.loadMore(ReportKind.Occupancy)
            advanceUntilIdle() // kapıda bekliyor

            viewModel.shiftPeriod(-1)
            viewModel.load(ReportKind.Occupancy)
            service.gate!!.complete(Unit)
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(ReportsViewModel.PAGE_SIZE, state.occupancy.valueOrNull!!.data.size)
            assertTrue(ReportKind.Occupancy !in state.loadingMore)
            assertEquals(Instant.parse("2026-07-31T21:00:00Z"), state.periodStart)
        }

    @Test
    @DisplayName("Karşılaştırma yalnız açılınca istenir; delta ve önceki dönem o zaman gelir")
    fun compareToggle() =
        runTest {
            val viewModel = subject()
            viewModel.shiftPeriod(-1)
            viewModel.load(ReportKind.Revenue)
            advanceUntilIdle()
            assertNull(viewModel.state.value.revenue.valueOrNull!!.delta)

            viewModel.setCompareToPrevious(true)
            viewModel.load(ReportKind.Revenue)
            advanceUntilIdle()
            val report = viewModel.state.value.revenue.valueOrNull!!
            assertNotNull(report.previous)
            assertTrue(report.delta!!.containsKey("collectedMinor"))
        }

    @Test
    @DisplayName("Gruplama değişince rapor o gruplamayla yükleniyor")
    fun groupingIsSent() =
        runTest {
            val viewModel = subject()
            viewModel.shiftPeriod(-1)
            viewModel.setOccupancyGrouping(OccupancyGrouping.Day)
            viewModel.load(ReportKind.Occupancy)
            advanceUntilIdle()

            val rows = viewModel.state.value.occupancy.valueOrNull!!.data
            assertTrue(rows.all { it.groupId == null && it.groupLabel.startsWith("2026-08-") })
        }

    @Test
    @DisplayName("Dışa aktarım: sayfasız ve karşılaştırmasız istenir; dosya adı şube gününden")
    fun exportPreparesFile() =
        runTest {
            var seen: Triple<ReportKind, ReportQuery, String?>? = null
            val service =
                object : ReportsService by mock() {
                    override suspend fun export(
                        kind: ReportKind,
                        query: ReportQuery,
                        groupBy: String?,
                    ): ByteArray {
                        seen = Triple(kind, query, groupBy)
                        return "csv".toByteArray()
                    }
                }
            val viewModel = subject(service)
            viewModel.setCompareToPrevious(true)
            viewModel.setOccupancyGrouping(OccupancyGrouping.Day)

            viewModel.export(ReportKind.Occupancy)
            advanceUntilIdle()

            val (kind, query, groupBy) = requireNotNull(seen)
            assertEquals(ReportKind.Occupancy, kind)
            assertFalse(query.compareToPrevious, "CSV karşılaştırma taşımaz")
            assertEquals("day", groupBy)
            val file = requireNotNull(viewModel.state.value.export.file)
            // Sunucunun `csvFilename` şeması; günler ŞUBE saatinde (UTC `Z` bir gün geriye yazardı).
            assertEquals("doluluk-2026-09-01-2026-10-01.csv", file.name)
            assertEquals("csv", file.bytes.decodeToString())
        }

    @Test
    @DisplayName("Kaydedilen baytlar durumdan DÜŞER; iptal edilen seçici de bir şey bırakmaz")
    fun exportIsForgottenAfterSave() =
        runTest {
            val viewModel = subject()
            viewModel.export(ReportKind.Retention)
            advanceUntilIdle()
            val name = viewModel.state.value.export.file!!.name

            var written: ByteArray? = null
            viewModel.save { written = it }
            advanceUntilIdle()

            assertNotNull(written)
            val export = viewModel.state.value.export
            assertNull(export.file, "sağlık/ciro verisi bellekte tutulmaz")
            assertEquals(name, export.savedName)

            viewModel.clearExport()
            assertNull(viewModel.state.value.export.savedName)
        }

    @Test
    @DisplayName("Dışa aktarım hatası ekranda mesaj; yazma hatası ayrı mesaj")
    fun exportFailures() =
        runTest {
            val viewModel = subject(mock("receptionist"))
            viewModel.export(ReportKind.Revenue)
            advanceUntilIdle()
            assertNotNull(viewModel.state.value.export.error)
            assertNull(viewModel.state.value.export.file)

            val ok = subject()
            ok.export(ReportKind.NoShow)
            advanceUntilIdle()
            ok.save { error("disk dolu") }
            advanceUntilIdle()
            assertEquals("Dosya kaydedilemedi. Başka bir konum deneyin.", ok.state.value.export.error)
        }

    @Test
    @DisplayName("Kapalı rapor 403 → Failed, yeniden denemesiz; uygulayıcı kendi kapsamında")
    fun forbiddenAndOwnScope() =
        runTest {
            val viewModel = subject(mock("practitioner"))
            viewModel.load(ReportKind.Revenue)
            viewModel.load(ReportKind.StaffPerformance)
            advanceUntilIdle()

            val revenue = viewModel.state.value.revenue
            assertTrue(revenue is Loadable.Failed)
            assertFalse((revenue as Loadable.Failed).isRetryable)
            assertEquals(ReportScope.Own, viewModel.state.value.staffPerformance.valueOrNull!!.scope)
        }
}
