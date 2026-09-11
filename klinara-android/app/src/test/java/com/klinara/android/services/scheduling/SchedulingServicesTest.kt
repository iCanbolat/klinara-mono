package com.klinara.android.services.scheduling

import com.klinara.android.services.booking.AvailabilityQuery
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

class SchedulingServicesTest {
    private val clock = BranchClock("Europe/Istanbul")

    // --- Sözleşme ---

    @Test
    @DisplayName("Şube saatleri `HH:mm:ss` ile çözülüyor; kapalı günde saat yok, Cumartesi molasız")
    fun branchHoursDecode() {
        val hours =
            KlinaraJson.decodeFromString(BranchHours.serializer(), Fixtures.read("scheduling/branch-hours.json"))
        val sunday = hours.entries.first { it.dayOfWeek == Weekday.Sunday.dow }
        val saturday = hours.entries.first { it.dayOfWeek == Weekday.Saturday.dow }

        assertTrue(sunday.isClosed)
        assertNull(sunday.open)
        assertEquals(ClockTime(16, 0), saturday.close)
        assertNull(saturday.breakStart)
        assertEquals(ClockTime(13, 0), hours.entries.first { it.dayOfWeek == 1 }.breakStart)
    }

    @Test
    @DisplayName("Program çözülüyor: Çarşamba izinli, çalışma günleri 10:00–18:00")
    fun staffScheduleDecode() {
        val schedule =
            KlinaraJson.decodeFromString(StaffSchedule.serializer(), Fixtures.read("scheduling/staff-schedule.json"))
        assertTrue(schedule.entries.first { it.dayOfWeek == Weekday.Wednesday.dow }.isOff)
        assertEquals(ClockTime(10, 0), schedule.entries.first { it.dayOfWeek == 1 }.start)
    }

    @Test
    @DisplayName("İstisna listesi: offset'li zaman, haftalık tekrar; tanınmayan tekrar türü `Unknown`, çökme yok")
    fun exceptionsDecode() {
        val list =
            KlinaraJson.decodeFromString(
                ListEnvelope.serializer(ScheduleException.serializer()),
                Fixtures.read("scheduling/schedule-exceptions.json"),
            ).data

        assertEquals(ScheduleRecurrence.Weekly, list[0].recurrenceType)
        assertEquals(2, list[0].recurrenceIntervalWeeks)
        assertEquals(Instant.parse("2026-09-17T12:00:00Z"), list[0].startsAt)
        assertEquals(ScheduleRecurrence.Unknown, list[1].recurrenceType)
    }

    @Test
    @DisplayName("Gövdeler: saatler `HH:mm` (saniyesiz), kapalı günde saat alanı YOK")
    fun bodies() {
        val body =
            branchHoursBody(
                listOf(
                    BranchHourInput(dayOfWeek = 0, isClosed = true),
                    BranchHourInput(dayOfWeek = 1, isClosed = false, open = ClockTime(9, 0), close = ClockTime(18, 30)),
                ),
            )
        val entries = body["entries"]!!.jsonArray
        assertFalse("openTime" in entries[0].jsonObject)
        assertEquals("18:30", entries[1].jsonObject["closeTime"]!!.jsonPrimitive.content)

        val oneOff =
            ScheduleExceptionInput(
                staffProfileId = "s",
                branchId = "b",
                startsAt = "2026-09-17T09:00:00+03:00",
                endsAt = "2026-09-17T18:00:00+03:00",
                recurrenceWeekdays = listOf(1),
            ).toJson()
        assertFalse("recurrenceUntil" in oneOff, "Tek seferlikte tekrar alanı sunucuda 400")
        assertFalse("recurrenceWeekdays" in oneOff)

        val weekly =
            ScheduleExceptionInput(
                staffProfileId = "s",
                branchId = "b",
                startsAt = "x",
                endsAt = "y",
                recurrenceType = ScheduleRecurrence.Weekly,
                recurrenceIntervalWeeks = 1,
                recurrenceUntil = "z",
                recurrenceWeekdays = listOf(4, 1),
            ).toJson()
        assertEquals(listOf(1, 4), weekly["recurrenceWeekdays"]!!.jsonArray.map { it.jsonPrimitive.int })
    }

    @Test
    @DisplayName("Weekday: 0 = Pazar (PostgreSQL dow), gösterim Pazartesi başlıyor")
    fun weekday() {
        assertEquals(Weekday.Sunday, Weekday.of(DayOfWeek.SUNDAY))
        assertEquals(1, Weekday.of(DayOfWeek.MONDAY).dow)
        assertEquals(Weekday.Monday, Weekday.displayOrder.first())
        assertEquals("Çar", Weekday.Wednesday.shortName)
        assertEquals(Weekday.entries.size, Weekday.entries.map { it.shortName }.toSet().size, "Kısaltmalar tekil")
    }

    // --- Mock sunucu kuralları ---

    private fun week(
        open: ClockTime = ClockTime(9, 0),
        close: ClockTime = ClockTime(18, 0),
    ) = (0..6).map { BranchHourInput(dayOfWeek = it, isClosed = false, open = open, close = close) }

    @Test
    @DisplayName("Mock: eksik gün ve kapalı günde saat 400; sıralama ihlali YANILTICI 409 (sunucu gibi)")
    fun mockValidations() =
        runTest {
            val service = MockSchedulingService(latencyEnabled = false)
            val missing =
                assertThrows<ApiError.Problem> { service.replaceBranchHours(MockIds.BRANCH_NISANTASI, week().drop(1)) }
            assertEquals(ApiErrorCode.VALIDATION_FAILED, missing.problem.code)

            val reversed =
                assertThrows<ApiError.Problem> {
                    service.replaceBranchHours(MockIds.BRANCH_NISANTASI, week(ClockTime(18, 0), ClockTime(9, 0)))
                }
            assertEquals(ApiErrorCode.CONFLICT, reversed.problem.code)
            assertEquals("Şube bu kiracıya ait değil", reversed.problem.title)

            val saved = service.replaceBranchHours(MockIds.BRANCH_NISANTASI, week())
            assertEquals("09:00:00", saved.entries.first().openTime, "Sunucu gibi saniyeli döner")
        }

    @Test
    @DisplayName("Mock: haftalık istisna bitiş tarihi ve gün ister; liste `from`'u yalnız startsAt ile karşılaştırır")
    fun mockExceptions() =
        runTest {
            val service = MockSchedulingService(clock = clock, latencyEnabled = false)
            val noUntil =
                assertThrows<ApiError.Problem> {
                    service.createException(
                        ScheduleExceptionInput(
                            staffProfileId = MockIds.STAFF_ONUR,
                            branchId = MockIds.BRANCH_NISANTASI,
                            startsAt = "2026-10-01T09:00:00+03:00",
                            endsAt = "2026-10-01T10:00:00+03:00",
                            recurrenceType = ScheduleRecurrence.Weekly,
                            recurrenceWeekdays = listOf(4),
                        ),
                    )
                }
            assertEquals(ApiErrorCode.VALIDATION_FAILED, noUntil.problem.code)

            // Tohumdaki haftalık eğitim yarın başlıyor: `from = yarından sonra` onu GİZLER (sunucu kusuru).
            val later = clock.adding(3L, Instant.now())
            val hidden =
                service.exceptions(ScheduleExceptionQuery(MockIds.BRANCH_NISANTASI, MockIds.STAFF_MERVE, from = later))
            assertTrue(hidden.isEmpty())
            val all = service.exceptions(ScheduleExceptionQuery(MockIds.BRANCH_NISANTASI, MockIds.STAFF_MERVE))
            assertEquals(1, all.size)

            service.deleteException(all.single().id)
            val remaining = service.exceptions(ScheduleExceptionQuery(MockIds.BRANCH_NISANTASI))
            assertTrue(remaining.none { it.id == all.single().id })
            assertThrows<ApiError.Problem> { service.deleteException(all.single().id) }
        }

    // --- Uygunluk: şube ∩ program − mola − istisna ---

    /** Bugünden sonraki ilk [day] (tohum randevularının uğramadığı kadar uzak). */
    private fun next(day: DayOfWeek): Instant {
        val date = LocalDate.now(clock.zone).plusWeeks(2).with(TemporalAdjusters.nextOrSame(day))
        return date.atStartOfDay(clock.zone).toInstant()
    }

    private fun booking(scheduling: MockSchedulingService) =
        MockBookingService(latencyEnabled = false, clock = clock, scheduling = scheduling)

    private suspend fun slots(
        booking: MockBookingService,
        day: Instant,
        serviceId: String = MockIds.SERVICE_SKIN_CARE,
        branchId: String = MockIds.BRANCH_NISANTASI,
    ) = booking.availability(AvailabilityQuery(branchId, listOf(serviceId), day, clock.adding(1L, day))).slots

    @Test
    @DisplayName("Pazar şube kapalı → slot yok; Pazartesi slotlar 09:00'dan, molada (13–14) slot yok")
    fun closedDayAndBreak() =
        runTest {
            val scheduling = MockSchedulingService(clock = clock, latencyEnabled = false)
            val booking = booking(scheduling)

            assertTrue(slots(booking, next(DayOfWeek.SUNDAY)).isEmpty())
            val monday = slots(booking, next(DayOfWeek.MONDAY))
            assertEquals(ClockTime(9, 0), clock.clockTime(monday.first().startsAt))
            assertTrue(monday.none { clock.clockTime(it.startsAt) in ClockTime(12, 15)..ClockTime(13, 45) })
        }

    @Test
    @DisplayName("Merve Çarşamba izinli: o gün lazer slotu yok; programı kaydedilince geliyor")
    fun staffDayOff() =
        runTest {
            val scheduling = MockSchedulingService(clock = clock, latencyEnabled = false)
            val booking = booking(scheduling)
            val wednesday = next(DayOfWeek.WEDNESDAY)
            assertTrue(slots(booking, wednesday, MockIds.SERVICE_LASER).isEmpty())

            scheduling.replaceStaffSchedule(
                MockIds.STAFF_MERVE,
                MockIds.BRANCH_NISANTASI,
                (0..6).map {
                    StaffScheduleEntryInput(it, isOff = false, start = ClockTime(10, 0), end = ClockTime(12, 0))
                },
            )
            val after = slots(booking, wednesday, MockIds.SERVICE_LASER)
            assertEquals(ClockTime(10, 0), clock.clockTime(after.first().startsAt))
            assertEquals(ClockTime(11, 15), clock.clockTime(after.last().startsAt), "45 dk + 12:00 sınırı")
        }

    @Test
    @DisplayName("Haftalık istisna şube YEREL tarihinde açılıyor ve o saatleri kapatıyor; kaldırılınca geri geliyor")
    fun weeklyExceptionBlocks() =
        runTest {
            val scheduling = MockSchedulingService(clock = clock, latencyEnabled = false)
            val booking = booking(scheduling)
            val thursday = next(DayOfWeek.THURSDAY)
            val created =
                scheduling.createException(
                    ScheduleExceptionInput(
                        staffProfileId = MockIds.STAFF_ONUR,
                        branchId = MockIds.BRANCH_NISANTASI,
                        startsAt = clock.wireValue(clock.date(clock.adding(-7L, thursday), ClockTime(9, 0))),
                        endsAt = clock.wireValue(clock.date(clock.adding(-7L, thursday), ClockTime(12, 0))),
                        recurrenceType = ScheduleRecurrence.Weekly,
                        recurrenceIntervalWeeks = 1,
                        recurrenceUntil = clock.wireValue(clock.adding(30L, thursday)),
                        recurrenceWeekdays = listOf(Weekday.Thursday.dow),
                    ),
                )
            val blocked = slots(booking, thursday, MockIds.SERVICE_CHECKUP)
            assertEquals(ClockTime(12, 0), clock.clockTime(blocked.first().startsAt), "Onur 09–12 izinli")

            scheduling.deleteException(created.id)
            val restored = slots(booking, thursday, MockIds.SERVICE_CHECKUP)
            assertEquals(ClockTime(9, 0), clock.clockTime(restored.first().startsAt))
        }

    @Test
    @DisplayName("İki haftada bir: aradaki hafta etkilenmiyor")
    fun biweekly() {
        val scheduling = MockSchedulingService(clock = clock, latencyEnabled = false)
        val first = LocalDate.of(2026, 9, 17)
        val exception =
            ScheduleException(
                id = "x",
                staffProfileId = "s",
                branchId = "b",
                startsAt = clock.instant(first, ClockTime(15, 0)),
                endsAt = clock.instant(first, ClockTime(16, 30)),
                recurrenceType = ScheduleRecurrence.Weekly,
                recurrenceIntervalWeeks = 2,
                recurrenceUntil = clock.instant(first.plusWeeks(8), ClockTime(23, 59)),
                recurrenceWeekdays = listOf(Weekday.Thursday.dow),
            )
        assertEquals(1, scheduling.occurrencesOn(exception, first).size)
        assertTrue(scheduling.occurrencesOn(exception, first.plusWeeks(1)).isEmpty())
        val third = scheduling.occurrencesOn(exception, first.plusWeeks(2)).single()
        assertEquals(ClockTime(15, 0), clock.clockTime(third.start))
    }

    @Test
    @DisplayName("Takvim bağlı değilse eski sabit 09:00–18:00 penceresi (tohumlu testler günden bağımsız)")
    fun fallbackWindow() =
        runTest {
            val booking = MockBookingService(latencyEnabled = false, clock = clock)
            val sunday = slots(booking, next(DayOfWeek.SUNDAY))
            assertEquals(ClockTime(9, 0), clock.clockTime(sunday.first().startsAt))
        }
}
