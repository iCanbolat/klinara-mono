package com.klinara.android.features.calendar

import com.klinara.android.services.booking.AppointmentListQuery
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.booking.CalendarDayQuery
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.booking.CalendarResponse
import com.klinara.android.services.booking.CalendarWeekQuery
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.MockClock
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.networking.Page
import com.klinara.android.services.staff.MockStaffService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class CalendarViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val clock = BranchClock("Europe/Istanbul")

    /** Sabit bir "bugün": testler makinenin takvimine bağlı olmamalı. */
    private val today = Instant.parse("2026-09-09T09:00:00Z")

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    /** Kaç kez çağrıldığını sayan sarmalayıcı — anahtarın işini kanıtlayan tek yol. */
    private class CountingBooking(
        private val delegate: BookingService,
    ) : BookingService {
        var dayCalls = 0
        var weekCalls = 0

        override suspend fun calendarDay(query: CalendarDayQuery): CalendarResponse {
            dayCalls++
            return delegate.calendarDay(query)
        }

        override suspend fun calendarWeek(query: CalendarWeekQuery): CalendarResponse {
            weekCalls++
            return delegate.calendarWeek(query)
        }

        override suspend fun appointments(query: AppointmentListQuery): Page<CalendarEntry> =
            delegate.appointments(query)

        // A3.3 uçları bu testin konusu değil; sayaç yalnız takvim okumalarını izliyor.
        override suspend fun appointment(id: String) = delegate.appointment(id)

        override suspend fun history(id: String) = delegate.history(id)

        override suspend fun updateNotes(
            id: String,
            version: Int,
            notes: String?,
        ) = delegate.updateNotes(id, version, notes)

        override suspend fun cancel(
            id: String,
            reason: String?,
        ) = delegate.cancel(id, reason)

        override suspend fun changeStatus(
            id: String,
            status: com.klinara.android.services.booking.AppointmentStatus,
            reason: String?,
        ) = delegate.changeStatus(id, status, reason)

        override suspend fun availability(
            query: com.klinara.android.services.booking.AvailabilityQuery,
        ) = delegate.availability(query)

        override suspend fun create(
            input: com.klinara.android.services.booking.CreateAppointmentInput,
            idempotencyKey: String,
        ) = delegate.create(input, idempotencyKey)

        override suspend fun reschedule(
            id: String,
            version: Int,
            input: com.klinara.android.services.booking.RescheduleAppointmentInput,
        ) = delegate.reschedule(id, version, input)
    }

    /**
     * Mock saati ViewModel'inkiyle AYNI ana bağlanır.
     *
     * Bağlanmasaydı tohum gerçek "bugün"e, ViewModel sabit [today]'e otururdu ve
     * testler makine takviminin hangi güne denk geldiğine göre bir gün geçer bir gün
     * kalırdı — en kötü türden kırılgan test.
     */
    private fun booking(scenario: MockDataScenario = MockDataScenario.BusyDay) =
        CountingBooking(MockBookingService(scenario, clock, MockClock(clock, today), latencyEnabled = false))

    private fun viewModel(service: BookingService) =
        CalendarViewModel(service, MockStaffService(latencyEnabled = false), clock, today)

    @Test
    @DisplayName("Ajanda ile gün arasında geçiş YENİDEN İSTEK ATMAZ — ikisi aynı günü ister")
    fun switchingBetweenAgendaAndDayDoesNotRefetch() {
        val service = booking()
        val model = viewModel(service)

        val agendaKey = model.loadKey(BRANCH)
        model.setMode(CalendarMode.Day)
        val dayKey = model.loadKey(BRANCH)

        assertEquals(agendaKey, dayKey, "Anahtar `mode`'u değil, türetilmiş kapsamı taşımalı.")
    }

    @Test
    @DisplayName("Hafta modunda AYNI hafta içinde gün değiştirmek istek atmaz")
    fun changingDayWithinTheSameWeekDoesNotRefetch() {
        val model = viewModel(booking())
        model.setMode(CalendarMode.Week)

        val before = model.loadKey(BRANCH)
        model.select(clock.adding(1, today))
        val after = model.loadKey(BRANCH)

        assertEquals(before, after, "Hafta kapsamı haftanın ilk gününe bağlı; gün değişimi onu oynatmaz.")
    }

    @Test
    @DisplayName("Hafta sınırını geçmek YENİ istek ister")
    fun crossingTheWeekBoundaryRefetches() {
        val model = viewModel(booking())
        model.setMode(CalendarMode.Week)

        val before = model.loadKey(BRANCH)
        model.step(1)
        val after = model.loadKey(BRANCH)

        assertNotEquals(before, after)
    }

    @Test
    @DisplayName("Personel filtresi ve şube kuşağı anahtarı DEĞİŞTİRİR")
    fun filterAndBranchGenerationChangeTheKey() {
        val model = viewModel(booking())

        val base = model.loadKey(BRANCH, branchGeneration = 0)
        model.toggleStaffFilter("51a11000-0000-4000-8000-000000000001")
        assertNotEquals(base, model.loadKey(BRANCH, branchGeneration = 0))

        model.toggleStaffFilter("51a11000-0000-4000-8000-000000000001")
        // Aynı şubeye geri dönülse bile kuşak sayacı arttıysa veri tazelenmeli;
        // yalnız `branchId` izlenseydi bayat gün ekranda kalırdı.
        assertNotEquals(base, model.loadKey(BRANCH, branchGeneration = 1))
    }

    @Test
    @DisplayName("Şube seçilmeden takvim ÇAĞRILMAZ — sunucuya 400 yollamak yerine sebebi söylenir")
    fun missingBranchIsExplainedNotRequested() =
        runTest {
            val service = booking()
            val model = viewModel(service)

            model.load(branchId = null)
            advanceUntilIdle()

            val failure = model.state.value.calendar as Loadable.Failed
            assertEquals(0, service.dayCalls, "Şube yoksa ağa hiç çıkılmamalı.")
            assertTrue(failure.message.contains("şube", ignoreCase = true))
        }

    @Test
    @DisplayName("Ağ hatası tekrar denenebilir olarak işaretlenir")
    fun networkFailureIsRetryable() =
        runTest {
            val failing =
                MockBookingService(clock = clock, mockClock = MockClock(clock, today), latencyEnabled = false)
                    .apply { failing = true }
            val model = viewModel(failing)

            model.load(BRANCH)
            advanceUntilIdle()

            val failure = model.state.value.calendar as Loadable.Failed
            assertTrue(failure.isRetryable, "Ağ hatasında 'Tekrar dene' düğmesi görünmeli.")
        }

    @Test
    @DisplayName("Personel listesi düşse de randevular çizilir")
    fun staffFailureDoesNotBlankTheDay() =
        runTest {
            val staff = MockStaffService(latencyEnabled = false).apply { failing = true }
            val booking = MockBookingService(clock = clock, mockClock = MockClock(clock, today), latencyEnabled = false)
            val model = CalendarViewModel(booking, staff, clock, today)

            model.load(BRANCH)
            model.loadStaff()
            advanceUntilIdle()

            assertTrue(model.state.value.calendar is Loadable.Loaded, "Takvim gelmeli.")
            assertTrue(model.state.value.staff is Loadable.Failed, "Personel düşmeli.")
            assertTrue(
                model.state.value.activeEntries.isNotEmpty(),
                "İkinci dereceden bir liste gelmedi diye günün tamamı gizlenmemeli.",
            )
        }

    @Test
    @DisplayName("Boş gün senaryosu gerçekten boş, yoğun gün gerçekten dolu")
    fun dataScenariosDiffer() =
        runTest {
            val empty = viewModel(booking(MockDataScenario.EmptyDay))
            val busy = viewModel(booking(MockDataScenario.BusyDay))

            empty.load(BRANCH)
            busy.load(BRANCH)
            advanceUntilIdle()

            assertTrue(empty.state.value.activeEntries.isEmpty())
            assertTrue(busy.state.value.activeEntries.isNotEmpty())
        }

    @Test
    @DisplayName("İptal ve gelmedi ayrı listede ama GİZLENMİYOR")
    fun terminalEntriesAreSeparatedNotHidden() =
        runTest {
            val model = viewModel(booking(MockDataScenario.BusyDay))

            model.load(BRANCH)
            advanceUntilIdle()

            val terminal = model.state.value.terminalEntries
            assertTrue(terminal.isNotEmpty(), "Yoğun gün senaryosu bir iptal ve bir gelmedi taşıyor.")
            assertTrue(model.state.value.activeEntries.none { it.status.isTerminal })
        }

    @Test
    @DisplayName("Yoğunluk personel filtresinden ETKİLENMEZ — sunucudaki davranış bu")
    fun densityIgnoresTheStaffFilter() =
        runTest {
            val model = viewModel(booking(MockDataScenario.BusyDay))

            model.load(BRANCH)
            advanceUntilIdle()
            val unfiltered = model.state.value.densityPeak

            model.toggleStaffFilter("51a11000-0000-4000-8000-000000000003")
            model.load(BRANCH)
            advanceUntilIdle()

            assertTrue(model.state.value.activeEntries.isNotEmpty())
            assertEquals(
                unfiltered,
                model.state.value.densityPeak,
                "Isı haritası şube geneli; daralsaydı ekrandaki 'şube geneli' notu yalan olurdu.",
            )
        }

    @Test
    @DisplayName("Aynı çipe tekrar dokunmak filtreyi temizler")
    fun tappingTheSameChipClearsTheFilter() {
        val model = viewModel(booking())

        model.toggleStaffFilter("x")
        assertEquals("x", model.state.value.staffFilter)
        model.toggleStaffFilter("x")
        assertEquals(null, model.state.value.staffFilter)
    }

    @Test
    @DisplayName("Adım genişliği moda bağlı: gün 1, hafta 7")
    fun stepWidthFollowsTheMode() {
        val model = viewModel(booking())

        val start = model.state.value.selectedDate
        model.step(1)
        assertEquals(clock.adding(1, start), model.state.value.selectedDate)

        model.setMode(CalendarMode.Week)
        model.step(1)
        assertEquals(clock.adding(DAYS_PER_WEEK + 1, start), model.state.value.selectedDate)
    }

    @Test
    @DisplayName("Sunucu hatası kullanıcı diline çevrilir, HTTP kodu sızmaz")
    fun problemsBecomeTurkishMessages() {
        val failure =
            Loadable.failed(
                ApiError.Problem(
                    com.klinara.android.services.networking.ProblemDetails(
                        code = ApiErrorCode.FORBIDDEN,
                        title = "Forbidden",
                        status = 403,
                    ),
                ),
            )

        assertEquals("Bu işlem için yetkiniz yok.", failure.message)
        assertTrue(!failure.isRetryable)
    }

    private companion object {
        const val BRANCH = "b1000000-0000-4000-8000-000000000001"
        const val DAYS_PER_WEEK = 7L
    }
}
