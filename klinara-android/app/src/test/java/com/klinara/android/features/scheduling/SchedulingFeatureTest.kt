package com.klinara.android.features.scheduling

import com.klinara.android.designsystem.components.DatePickerMillis
import com.klinara.android.features.shell.ShellSessions
import com.klinara.android.features.shell.managementSections
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.scheduling.BranchHourInput
import com.klinara.android.services.scheduling.BranchHours
import com.klinara.android.services.scheduling.MockSchedulingService
import com.klinara.android.services.scheduling.ScheduleException
import com.klinara.android.services.scheduling.ScheduleRecurrence
import com.klinara.android.services.scheduling.SchedulingService
import com.klinara.android.services.scheduling.StaffSchedule
import com.klinara.android.services.scheduling.Weekday
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
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate

@OptIn(ExperimentalCoroutinesApi::class)
class SchedulingFeatureTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private val istanbul = BranchClock("Europe/Istanbul")

    // --- Şube haftası ---

    @Test
    @DisplayName("Kaydı olmayan gün açık 09:00–18:00; gövde daima 7 gün, kapalı günde saat yok")
    fun weekHoursDefaultsAndBody() {
        val draft = WeekHoursDraft.of(BranchHours("b"))
        val inputs = draft.inputs()

        assertEquals(7, inputs.size)
        assertEquals(ClockTime(9, 0), inputs.first().open)
        val closed = draft.update(Weekday.Sunday) { it.copy(isClosed = true) }.inputs().first { it.dayOfWeek == 0 }
        assertEquals(BranchHourInput(dayOfWeek = 0, isClosed = true), closed)
    }

    @Test
    @DisplayName("İstemci doğrulaması: kapanış açılıştan önce ve mola dışarıda GEÇERSİZ; kapalı gün her zaman geçerli")
    fun weekHoursValidation() {
        val base = WeekHoursDraft.of(BranchHours("b"))
        val reversed = base.update(Weekday.Monday) { it.copy(open = ClockTime(18, 0), close = ClockTime(9, 0)) }
        assertFalse(reversed.isValid)
        assertEquals("Kapanış açılıştan sonra olmalı.", reversed.day(Weekday.Monday).error)

        val breakOutside =
            base.update(Weekday.Monday) {
                it.copy(hasBreak = true, breakStart = ClockTime(8, 0), breakEnd = ClockTime(9, 30))
            }
        assertEquals("Mola açık saatlerin içinde olmalı.", breakOutside.day(Weekday.Monday).error)

        assertTrue(reversed.update(Weekday.Monday) { it.copy(isClosed = true) }.isValid)
    }

    @Test
    @DisplayName("'Tüm açık günlere uygula' kapalı günü AÇMIYOR")
    fun applyToOpenDays() {
        val draft =
            WeekHoursDraft
                .of(BranchHours("b"))
                .update(Weekday.Sunday) { it.copy(isClosed = true) }
                .update(Weekday.Monday) { it.copy(open = ClockTime(8, 0), hasBreak = true) }
                .applyToOpenDays(Weekday.Monday)

        assertTrue(draft.day(Weekday.Sunday).isClosed)
        assertEquals(ClockTime(8, 0), draft.day(Weekday.Friday).open)
        assertTrue(draft.day(Weekday.Friday).hasBreak)
    }

    @Test
    @DisplayName("Geçersiz hafta SUNUCUYA GİTMİYOR — yanıltıcı 409'a hiç düşülmüyor")
    fun invalidWeekNotSent() =
        runTest {
            var calls = 0
            val inner = MockSchedulingService(latencyEnabled = false)
            val counting =
                object : SchedulingService by inner {
                    override suspend fun replaceBranchHours(
                        branchId: String,
                        entries: List<BranchHourInput>,
                    ): BranchHours {
                        calls += 1
                        return inner.replaceBranchHours(branchId, entries)
                    }
                }
            val viewModel = BranchHoursViewModel(counting, MockIds.BRANCH_NISANTASI)
            viewModel.load()
            advanceUntilIdle()

            viewModel.update { it.update(Weekday.Monday) { day -> day.copy(close = ClockTime(8, 0)) } }
            viewModel.save()
            advanceUntilIdle()
            assertEquals(0, calls)

            viewModel.update { it.update(Weekday.Monday) { day -> day.copy(close = ClockTime(20, 0)) } }
            viewModel.save()
            advanceUntilIdle()
            assertEquals(1, calls)
            assertTrue(viewModel.state.value.didSave)
            assertFalse(viewModel.state.value.draft!!.isDirty, "Orijinal sunucunun yanıtından yenilendi")
        }

    // --- Personel haftası ---

    @Test
    @DisplayName("Programı olmayan personel: taslak kirli değil ama kaydedilebilir (varsayılanı yazmak bir karar)")
    fun staffWithoutRecordCanSave() =
        runTest {
            val viewModel =
                StaffScheduleViewModel(
                    MockSchedulingService(latencyEnabled = false),
                    MockStaffService(latencyEnabled = false),
                    MockIds.STAFF_DERYA,
                    MockIds.BRANCH_BODRUM,
                )
            viewModel.load()
            advanceUntilIdle()

            val state = viewModel.state.value
            assertTrue(state.hasNoRecord)
            assertFalse(state.draft!!.isDirty)
            assertTrue(state.canSave)
        }

    @Test
    @DisplayName("Personel haftası: izinli gün saat taşımıyor, başlangıç ≥ bitiş geçersiz")
    fun staffWeek() {
        val draft = StaffWeekDraft.of(StaffSchedule("s", "b"))
        val off = draft.update(Weekday.Monday) { it.copy(isWorking = false) }.inputs().first { it.dayOfWeek == 1 }
        assertTrue(off.isOff)
        assertNull(off.start)
        assertFalse(draft.update(Weekday.Tuesday) { it.copy(start = ClockTime(18, 0)) }.isValid)
    }

    // --- İstisna taslağı ---

    private fun draft(clock: BranchClock = istanbul) =
        ScheduleExceptionDraft(clock = clock, staffProfileId = "s", startDate = LocalDate.of(2026, 9, 17))

    @Test
    @DisplayName("Başlangıç bitişi geçince bitiş bir saat sonrasına itiliyor; tekrar bitişi de itiliyor")
    fun pushRules() {
        val pushed = draft().withStart(time = ClockTime(19, 0))
        assertEquals(ClockTime(20, 0), pushed.endTime)
        assertEquals(LocalDate.of(2026, 9, 17), pushed.endDate)

        val lateNight = draft().withStart(time = ClockTime(23, 30))
        assertEquals(LocalDate.of(2026, 9, 18), lateNight.endDate, "Gece yarısını geçen itme ertesi güne")

        val farStart = draft().withStart(date = LocalDate.of(2026, 12, 1))
        assertTrue(farStart.untilDate.isAfter(farStart.endDate))
    }

    @Test
    @DisplayName("Haftalık tekrar gün ister; tek seferlikte gövdede tekrar alanı YOK")
    fun recurrenceValidation() {
        val weekly = draft().copy(recurrence = ScheduleRecurrence.Weekly)
        assertEquals("En az bir gün seçin.", weekly.recurrenceError)
        assertNull(weekly.input("b"))

        val ok = weekly.toggleWeekday(Weekday.Thursday.dow)
        assertTrue(ok.isValid)
        assertEquals(listOf(4), ok.input("b")!!.recurrenceWeekdays)

        val oneOff = draft().toggleWeekday(4).input("b")!!
        assertNull(oneOff.recurrenceUntil)
        assertTrue(oneOff.recurrenceWeekdays.isEmpty())
    }

    @Test
    @DisplayName("Kablo değeri ŞUBE offset'iyle: İstanbul +03:00, Berlin yazın +02:00 kışın +01:00 (DST)")
    fun wireUsesBranchOffset() {
        assertEquals("2026-09-17T09:00:00+03:00", draft().input("b")!!.startsAt)

        val berlin = BranchClock("Europe/Berlin")
        assertEquals("2026-09-17T09:00:00+02:00", draft(berlin).input("b")!!.startsAt)
        val winter = draft(berlin).withStart(date = LocalDate.of(2026, 11, 5))
        assertEquals("2026-11-05T09:00:00+01:00", winter.input("b")!!.startsAt, "Duvar saati korunuyor")
    }

    @Test
    @DisplayName("Tekrarın son günü gün sonuna kadar kapsanıyor")
    fun untilIsEndOfDay() {
        val weekly = draft().copy(recurrence = ScheduleRecurrence.Weekly, weekdays = setOf(4))
        assertEquals(ClockTime(23, 59), istanbul.clockTime(weekly.recurrenceUntil))
    }

    // --- İstisna listesi ---

    @Test
    @DisplayName("Liste `from` göndermiyor: süren haftalık istisna görünüyor, bitmiş olan görünmüyor")
    fun stillRelevant() {
        val today = Instant.parse("2026-09-11T00:00:00Z")
        val base =
            ScheduleException(
                id = "x",
                staffProfileId = "s",
                branchId = "b",
                startsAt = today.minusSeconds(8 * 86_400),
                endsAt = today.minusSeconds(8 * 86_400 - 3_600),
            )
        assertFalse(ScheduleExceptionListViewModel.stillRelevant(base, today))
        val weekly = base.copy(recurrenceType = ScheduleRecurrence.Weekly, recurrenceUntil = today.plusSeconds(86_400))
        assertTrue(ScheduleExceptionListViewModel.stillRelevant(weekly, today))
    }

    @Test
    @DisplayName("Kaldırma hatası yutulmuyor; başarıda liste yeniden çekiliyor")
    fun deleteFlow() =
        runTest {
            val inner = MockSchedulingService(clock = istanbul, latencyEnabled = false)
            var failDelete = true
            val service =
                object : SchedulingService by inner {
                    override suspend fun deleteException(id: String) {
                        if (failDelete) throw ApiError.Network()
                        inner.deleteException(id)
                    }
                }
            val viewModel =
                ScheduleExceptionListViewModel(
                    service,
                    MockStaffService(latencyEnabled = false),
                    MockIds.BRANCH_NISANTASI,
                    staffProfileId = null,
                    clock = istanbul,
                )
            viewModel.load()
            advanceUntilIdle()
            val rows = viewModel.state.value.rows.valueOrNull!!
            assertEquals(2, rows.size, "Tohum: Derya'nın izni + Merve'nin haftalık eğitimi")
            assertEquals("Derya Aksoy", viewModel.state.value.staffNames[MockIds.STAFF_DERYA])

            viewModel.askDelete(rows.first())
            viewModel.confirmDelete()
            advanceUntilIdle()
            assertNotNull(viewModel.state.value.error)
            assertEquals(2, viewModel.state.value.rows.valueOrNull!!.size)

            failDelete = false
            viewModel.askDelete(rows.first())
            viewModel.confirmDelete()
            advanceUntilIdle()
            assertEquals(1, viewModel.state.value.rows.valueOrNull!!.size)
        }

    @Test
    @DisplayName("Tekrar etiketi: 'Pzt, Per · 2 haftada bir'")
    fun recurrenceText() {
        val exception =
            ScheduleException(
                id = "x",
                staffProfileId = "s",
                branchId = "b",
                startsAt = Instant.EPOCH,
                endsAt = Instant.EPOCH.plusSeconds(60),
                recurrenceType = ScheduleRecurrence.Weekly,
                recurrenceIntervalWeeks = 2,
                recurrenceWeekdays = listOf(4, 1),
            )
        assertEquals("Pzt, Per · 2 haftada bir", recurrenceLabel(exception))
        assertNull(recurrenceLabel(exception.copy(recurrenceType = ScheduleRecurrence.None)))
    }

    // --- Tasarım sistemi + izinler ---

    @Test
    @DisplayName("DatePicker UTC milisaniyesi ↔ LocalDate: UTC'nin gerisindeki dilimde gün kaymıyor")
    fun datePickerMillis() {
        val date = LocalDate.of(2026, 3, 29)
        assertEquals(date, DatePickerMillis.toDate(DatePickerMillis.fromDate(date)))
        assertEquals(LocalDate.of(2026, 3, 29), DatePickerMillis.toDate(1_774_742_400_000L))
    }

    @Test
    @DisplayName("Takvim kurulumu kartı `schedule:read` ile; dipnot şube saat dilimini söylüyor")
    fun permissions() {
        val roles = listOf("owner", "manager", "receptionist", "practitioner")
        val sees =
            roles.filter { role ->
                managementSections(ShellSessions.forRole(role)).any { it.title == "Takvim kurulumu" }
            }
        assertEquals(listOf("owner", "manager", "receptionist", "practitioner"), sees)

        val footnote =
            managementSections(ShellSessions.forRole("manager")).first { it.title == "Takvim kurulumu" }.footnote
        assertEquals("Saatler Nişantaşı şubesinin saat diliminde (Europe/Istanbul) gösterilir.", footnote)
    }
}
