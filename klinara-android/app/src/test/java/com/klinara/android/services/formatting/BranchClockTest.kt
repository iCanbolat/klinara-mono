package com.klinara.android.services.formatting

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

class ClockTimeTest {
    @Test
    @DisplayName("HH:mm ve HH:mm:ss kabul edilir")
    fun parsesBothWireForms() {
        assertEquals(ClockTime(9, 0), ClockTime.parse("09:00"))
        assertEquals(ClockTime(9, 0), ClockTime.parse("09:00:00"))
        assertEquals(ClockTime(18, 30), ClockTime.parse("18:30"))
    }

    @Test
    @DisplayName("Geçersiz biçimler reddedilir")
    fun rejectsInvalidForms() {
        assertNull(ClockTime.parse("9:00"), "Tek haneli saat reddedilmeli")
        assertNull(ClockTime.parse("24:00"), "24 geçerli bir saat değil")
        assertNull(ClockTime.parse("09:60"))
        assertNull(ClockTime.parse("abc"))
        assertNull(ClockTime.parse(null))
        assertNull(ClockTime.parse("0900"))
    }

    @Test
    @DisplayName("Sunucu biçimi saniyeli")
    fun serverFormatAddsSeconds() {
        assertEquals("09:00:00", ClockTime.serverFormatted("09:00"))
        assertNull(ClockTime.serverFormatted("geçersiz"))
    }

    @Test
    @DisplayName("Sıralama gün içi konuma göre")
    fun ordersByPositionInDay() {
        assertTrue(ClockTime.nineAM < ClockTime.sixPM)
        assertEquals(540, ClockTime.nineAM.minutesFromMidnight)
        assertEquals(1080, ClockTime.sixPM.minutesFromMidnight)
        assertEquals("09:00", ClockTime.nineAM.wireValue)
    }
}

class BranchClockTest {
    private val istanbul = BranchClock("Europe/Istanbul")

    @Nested
    @DisplayName("Saat dilimi çözümü")
    inner class ZoneResolution {
        @Test
        @DisplayName("Bilinmeyen dilim Europe/Istanbul'a düşer")
        fun unknownZoneFallsBack() {
            assertEquals(ZoneId.of("Europe/Istanbul"), BranchClock("Mars/Olympus").zone)
            assertEquals(ZoneId.of("Europe/Istanbul"), BranchClock(null).zone)
        }

        @Test
        @DisplayName("Geçerli dilim olduğu gibi kullanılır")
        fun validZoneIsHonoured() {
            assertEquals(ZoneId.of("Europe/Berlin"), BranchClock("Europe/Berlin").zone)
        }
    }

    @Test
    @DisplayName("Cihaz dilimi DEĞİL şube dilimi kullanılır")
    fun usesBranchZoneNotDeviceZone() {
        val instant = Instant.parse("2026-09-09T21:30:00Z")
        // Aynı an, iki şubede farklı gün.
        assertEquals("10.09.2026".take(2), istanbul.dayNumber(instant).padStart(2, '0'))
        assertNotEquals(
            istanbul.formatTime(instant),
            BranchClock("Europe/London").formatTime(instant),
        )
    }

    @Test
    @DisplayName("Hafta PAZARTESİ başlar ve yedi gün sürer")
    fun weekStartsOnMonday() {
        // 2026-09-09 Çarşamba.
        val wednesday = Instant.parse("2026-09-09T10:00:00Z")
        val days = istanbul.weekDays(wednesday)

        assertEquals(7, days.size)
        assertEquals("2026-09-07", istanbul.localDateString(days.first()))
        assertEquals("2026-09-13", istanbul.localDateString(days.last()))
    }

    @Test
    @DisplayName("DST sınırında gün ekleme takvimi KAYDIRMAZ")
    fun addingDaysSurvivesDstBoundary() {
        // Üretim İstanbul (2016'dan beri sabit UTC+3) ama kural DST'li bir dilimde
        // sınanmalı: plusSeconds(86400) kullanılsaydı burada bir saat kayardı.
        val berlin = BranchClock("Europe/Berlin")
        // 2026'da AB yaz saati Mart'ın SON pazarı, yani 29 Mart 02:00'de başlar.
        // Kısa gün 29 Mart'tır (23 saat), 28'i değil.
        val before = berlin.date("2026-03-29")!!
        val after = berlin.adding(1, before)

        assertEquals("2026-03-30", berlin.localDateString(after))
        assertEquals(
            berlin.startOfDay(after),
            after,
            "Gün ekleme yine gün başına denk gelmeli — 23 saatlik gün bunu bozmamalı",
        )
        assertEquals(
            Duration.ofHours(23),
            Duration.between(before, after),
            "O gece gerçekten 23 saat; sabit 24 saat eklemek yanlış olurdu",
        )
    }

    @Test
    @DisplayName("Ay ve gün başı şube diliminde hesaplanır")
    fun boundariesUseBranchZone() {
        val mid = Instant.parse("2026-09-15T13:45:00Z")

        assertEquals("2026-09-01", istanbul.localDateString(istanbul.startOfMonth(mid)))
        assertEquals("2026-09-15", istanbul.localDateString(istanbul.startOfDay(mid)))
        assertEquals("00:00", istanbul.formatTime(istanbul.startOfDay(mid)))
    }

    @Test
    @DisplayName("Belirli bir gün ve saatten an üretimi")
    fun buildsInstantFromDayAndTime() {
        val day = istanbul.date("2026-09-09")!!
        val at = istanbul.date(day, ClockTime(14, 30))

        assertEquals("14:30", istanbul.formatTime(at))
        assertEquals("2026-09-09", istanbul.localDateString(at))
    }

    @Test
    @DisplayName("Dakika aritmetiği ve gün içi konum")
    fun minuteArithmetic() {
        val start = istanbul.date(istanbul.date("2026-09-09")!!, ClockTime(9, 0))
        val end = istanbul.addingMinutes(90, start)

        assertEquals(90, istanbul.minutes(start, end))
        assertEquals(540, istanbul.minutesFromMidnight(start))
        assertEquals("10:30", istanbul.formatTime(end))
    }

    @Test
    @DisplayName("Aynı gün karşılaştırması şube diliminde")
    fun sameDayComparison() {
        val morning = Instant.parse("2026-09-09T06:00:00Z")
        val evening = Instant.parse("2026-09-09T18:00:00Z")
        val nextDay = Instant.parse("2026-09-10T06:00:00Z")

        assertTrue(istanbul.isSameDay(morning, evening))
        assertFalse(istanbul.isSameDay(morning, nextDay))
        assertTrue(istanbul.isToday(morning, now = evening))
    }

    @Test
    @DisplayName("Kablo biçimi şube offset'ini taşır")
    fun wireValueCarriesBranchOffset() {
        val instant = Instant.parse("2026-09-09T11:00:00Z")
        assertEquals("2026-09-09T14:00:00+03:00", istanbul.wireValue(instant))
    }

    @Test
    @DisplayName("Bozuk tarih metni null döner")
    fun invalidDateStringReturnsNull() {
        assertNull(istanbul.date("dokuz eylül"))
        assertNull(istanbul.date("2026-13-45"))
    }
}
