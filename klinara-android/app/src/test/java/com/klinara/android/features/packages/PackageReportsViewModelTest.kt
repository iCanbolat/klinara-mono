package com.klinara.android.features.packages

import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.MockPackagesService
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
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class PackageReportsViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private val clock = BranchClock("Europe/Istanbul")
    private val service = MockPackagesService(latencyEnabled = false)

    private fun subject() =
        PackageReportsViewModel(service, clock, branchId = null, now = Instant.parse("2026-09-11T09:00:00Z"))

    @Test
    @DisplayName("Dönem ayın ilk anından ertesi ayın ilk anına; etiket SON GÜNÜ gösteriyor")
    fun periodIsHalfOpenAndLabelInclusive() {
        val viewModel = subject()
        val state = viewModel.state.value

        assertEquals(Instant.parse("2026-08-31T21:00:00Z"), state.periodStart)
        assertEquals(Instant.parse("2026-09-30T21:00:00Z"), state.periodEnd)
        // "1 Eyl – 1 Eki" DEĞİL: üst sınır hariç, kullanıcıya bir gün öncesi yazılır.
        assertTrue(viewModel.periodLabel(state).contains("30 Eylül"))
        assertFalse(viewModel.periodLabel(state).contains("Ekim"))
    }

    @Test
    @DisplayName("Dönem kaydırmak ay sınırlarını koruyor")
    fun shiftKeepsMonthBoundaries() {
        val viewModel = subject()

        viewModel.shiftPeriod(1)

        assertEquals(Instant.parse("2026-09-30T21:00:00Z"), viewModel.state.value.periodStart)
        assertEquals(Instant.parse("2026-10-31T21:00:00Z"), viewModel.state.value.periodEnd)
    }

    @Test
    @DisplayName("Süre dolumu sayfalanıyor; imleç bitince loadMore hiçbir şey yapmıyor")
    fun expiringLoadsAndStopsAtLastPage() =
        runTest {
            val viewModel = subject()

            viewModel.loadExpiring()
            advanceUntilIdle()
            viewModel.loadMoreExpiring()
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(2, state.expiring.valueOrNull?.data?.size)
            assertFalse(state.canLoadMoreExpiring)
        }

    @Test
    @DisplayName("Bir raporun hatası diğerinin yüklü verisini SİLMİYOR — ayrı Loadable'lar")
    fun oneReportFailureDoesNotClearAnother() =
        runTest {
            val viewModel = subject()
            viewModel.loadExpiring()
            advanceUntilIdle()

            service.failing = true
            viewModel.loadUsage()
            advanceUntilIdle()

            assertTrue(viewModel.state.value.expiring is Loadable.Loaded)
            assertTrue(viewModel.state.value.usage is Loadable.Failed)
        }
}
