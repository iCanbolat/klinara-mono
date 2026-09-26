package com.klinara.android.features.calendar.booking

import com.klinara.android.services.booking.AvailabilityDay
import com.klinara.android.services.booking.AvailabilityDayStatus
import com.klinara.android.services.booking.AvailabilityResponse
import com.klinara.android.services.booking.AvailabilitySlot
import com.klinara.android.services.formatting.BranchClock
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

class AvailabilityPresentationTest {
    private val clock = BranchClock("Europe/Istanbul")

    private fun slot(hhmm: String): AvailabilitySlot {
        val start = Instant.parse("2026-09-29T$hhmm:00+03:00")
        return AvailabilitySlot(startsAt = start, endsAt = start.plusSeconds(1800), staffProfileIds = listOf("p1"))
    }

    private fun day(
        status: AvailabilityDayStatus,
        holiday: String? = null,
        opens: String? = "09:00",
        closes: String? = "18:00",
    ) = AvailabilityDay(date = "2026-09-29", status = status, holidayName = holiday, opensAt = opens, closesAt = closes)

    @Test
    @DisplayName("Slotlar şube saatine göre sabah / öğleden sonra / akşam gruplanır")
    fun groupsByPeriod() {
        val groups =
            AvailabilityPresentation.group(
                listOf(slot("09:00"), slot("11:45"), slot("12:00"), slot("16:45"), slot("17:00")),
                clock,
            )
        assertEquals(
            listOf(
                AvailabilityPresentation.Period.Morning,
                AvailabilityPresentation.Period.Afternoon,
                AvailabilityPresentation.Period.Evening,
            ),
            groups.map { it.period },
        )
        assertEquals(listOf(2, 2, 1), groups.map { it.slots.size })
    }

    @Test
    @DisplayName("Boş listenin nedeni gün durumundan gelir")
    fun emptyNotice() {
        val holiday = AvailabilityPresentation.emptyNotice(day(AvailabilityDayStatus.Holiday, holiday = "Bayram"))
        assertEquals("Tatil · Bayram", holiday.title)
        assertTrue(holiday.isDayRule)
        assertEquals("Şube bu gün kapalı", AvailabilityPresentation.emptyNotice(day(AvailabilityDayStatus.Closed)).title)
        assertFalse(AvailabilityPresentation.emptyNotice(day(AvailabilityDayStatus.BeyondWindow)).suggestsNextDay)

        val full = AvailabilityPresentation.emptyNotice(day(AvailabilityDayStatus.Open))
        assertEquals("Bu gün boş saat kalmadı", full.title)
        // Eski sunucu (`days` yok) → dolu kabul.
        assertEquals(full, AvailabilityPresentation.emptyNotice(null))
    }

    @Test
    @DisplayName("Yarım gün tatil açık günde not olarak görünür")
    fun openDayNote() {
        assertEquals(
            "Arife · kısaltılmış çalışma saatleri 09:00–13:00",
            AvailabilityPresentation.openDayNote(
                day(AvailabilityDayStatus.Open, holiday = "Arife", opens = "09:00", closes = "13:00"),
            ),
        )
        assertNull(AvailabilityPresentation.openDayNote(day(AvailabilityDayStatus.Open)))
    }

    @Test
    @DisplayName("`days` eksik ya da bilinmeyen durumlu yanıt çözülür")
    fun decodesDays() {
        val json = Json { ignoreUnknownKeys = true }
        val legacy =
            json.decodeFromString<AvailabilityResponse>(
                """{"branchId":"b","timezone":"Europe/Istanbul","slotGranularityMinutes":15,"slots":[]}""",
            )
        assertTrue(legacy.days.isEmpty())

        val current =
            json.decodeFromString<AvailabilityResponse>(
                """
                {"branchId":"b","timezone":"Europe/Istanbul","slotGranularityMinutes":15,"slots":[],
                 "days":[{"date":"2026-09-29","status":"beyond_window","holidayName":null,"opensAt":null,"closesAt":null},
                         {"date":"2026-09-30","status":"something_new","holidayName":null,"opensAt":null,"closesAt":null}]}
                """.trimIndent(),
            )
        assertEquals(AvailabilityDayStatus.BeyondWindow, current.day("2026-09-29")?.status)
        assertEquals(AvailabilityDayStatus.Unknown, current.day("2026-09-30")?.status)
    }
}
