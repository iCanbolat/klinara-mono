package com.klinara.android.services.formatting

import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters

/**
 * Gün içi saat: `HH:mm`. Çalışma saatleri ve şablon saatleri için.
 */
data class ClockTime(
    val hour: Int,
    val minute: Int,
) : Comparable<ClockTime> {
    /** Sunucuya giden biçim. */
    val wireValue: String get() = "%02d:%02d".format(hour, minute)

    val displayValue: String get() = wireValue

    val minutesFromMidnight: Int get() = hour * MINUTES_PER_HOUR + minute

    override fun compareTo(other: ClockTime): Int =
        minutesFromMidnight.compareTo(other.minutesFromMidnight)

    companion object {
        private const val MINUTES_PER_HOUR = 60
        private const val MAX_HOUR = 23
        private const val MAX_MINUTE = 59

        /** `HH:mm` iki, `HH:mm:ss` üç parça; her alan iki hane. */
        private const val HH_MM = 2
        private const val HH_MM_SS = 3
        private const val FIELD_WIDTH = 2

        val nineAM = ClockTime(9, 0)
        val sixPM = ClockTime(18, 0)

        /** `"09:00"` ve `"09:00:00"` kabul edilir; `"9:00"` ve `"24:00"` edilmez. */
        fun parse(raw: String?): ClockTime? {
            val parts = raw?.split(':') ?: return null
            val wellFormed =
                parts.size in HH_MM..HH_MM_SS &&
                    parts[0].length == FIELD_WIDTH &&
                    parts[1].length == FIELD_WIDTH
            if (!wellFormed) return null

            val hour = parts[0].toIntOrNull() ?: return null
            val minute = parts[1].toIntOrNull() ?: return null
            if (hour !in 0..MAX_HOUR || minute !in 0..MAX_MINUTE) return null

            return ClockTime(hour, minute)
        }

        /** Sunucu saniyeli biçim bekliyor: `"09:00"` → `"09:00:00"`. */
        fun serverFormatted(raw: String?): String? = parse(raw)?.let { "${it.wireValue}:00" }
    }
}

/**
 * Şubenin saat diliminde tarih/saat aritmetiği ve gösterimi.
 *
 * **Cihazın saat dilimi ASLA kullanılmaz.** Tüm zaman damgaları sunucudan UTC gelir ve
 * şubenin diliminde gösterilir; aksi hâlde seyahat eden bir yönetici takvimi kaymış
 * görür ve olmayan bir çakışma bildirir.
 *
 * Hafta Pazartesi başlar (`firstWeekday = 2` paritesi).
 */
class BranchClock(timeZoneIdentifier: String?) {
    val zone: ZoneId = resolveZone(timeZoneIdentifier)

    // --- Gösterim ---

    fun formatDateTime(instant: Instant): String = DATE_TIME.format(instant.atZone(zone))

    fun formatDate(instant: Instant): String = DATE.format(instant.atZone(zone))

    fun formatTime(instant: Instant): String = TIME.format(instant.atZone(zone))

    fun formatRange(
        from: Instant,
        to: Instant,
    ): String = "${formatTime(from)} – ${formatTime(to)}"

    /** Tarih şeridi için tek harf: P S Ç P C C P. */
    fun weekdayInitial(instant: Instant): String = WEEKDAY_INITIAL.format(instant.atZone(zone))

    fun dayNumber(instant: Instant): String = DAY_NUMBER.format(instant.atZone(zone))

    // --- Kablo biçimi ---

    /** Şube offset'iyle ISO 8601 — sunucuya giden biçim. */
    fun wireValue(instant: Instant): String = WIRE.format(instant.atZone(zone))

    fun localDateString(instant: Instant): String = DateTimeFormatter.ISO_LOCAL_DATE.format(instant.atZone(zone))

    fun date(localDateString: String): Instant? =
        runCatching {
            LocalDate.parse(localDateString).atStartOfDay(zone).toInstant()
        }.getOrNull()

    // --- Aritmetik ---

    fun date(
        day: Instant,
        at: ClockTime,
    ): Instant =
        day
            .atZone(zone)
            .with(LocalTime.of(at.hour, at.minute))
            .toInstant()

    fun startOfDay(instant: Instant): Instant = instant.atZone(zone).toLocalDate().atStartOfDay(zone).toInstant()

    /**
     * `plusDays` KULLANILIR, `plusSeconds(86400)` DEĞİL: DST geçişi olan bir dilimde
     * gün ekleme 23 ya da 25 saat sürebilir ve sabit saniye eklemek takvimi kaydırır.
     */
    fun adding(
        days: Long,
        to: Instant,
    ): Instant = to.atZone(zone).plusDays(days).toInstant()

    fun addingMonths(
        months: Long,
        to: Instant,
    ): Instant = to.atZone(zone).plusMonths(months).toInstant()

    fun addingMinutes(
        minutes: Long,
        to: Instant,
    ): Instant = to.plusSeconds(minutes * SECONDS_PER_MINUTE)

    fun startOfMonth(instant: Instant): Instant =
        instant
            .atZone(zone)
            .with(TemporalAdjusters.firstDayOfMonth())
            .toLocalDate()
            .atStartOfDay(zone)
            .toInstant()

    /** Hafta Pazartesi başlar. */
    fun startOfWeek(instant: Instant): Instant =
        instant
            .atZone(zone)
            .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            .toLocalDate()
            .atStartOfDay(zone)
            .toInstant()

    fun weekDays(instant: Instant): List<Instant> {
        val start = startOfWeek(instant)
        return (0 until DAYS_PER_WEEK).map { adding(it.toLong(), start) }
    }

    fun minutes(
        from: Instant,
        to: Instant,
    ): Int = Duration.between(from, to).toMinutes().toInt()

    fun minutesFromMidnight(instant: Instant): Int {
        val zoned: ZonedDateTime = instant.atZone(zone)
        return zoned.hour * MINUTES_PER_HOUR + zoned.minute
    }

    fun isSameDay(
        first: Instant,
        second: Instant,
    ): Boolean = first.atZone(zone).toLocalDate() == second.atZone(zone).toLocalDate()

    fun isToday(
        instant: Instant,
        now: Instant = Instant.now(),
    ): Boolean = isSameDay(instant, now)

    private companion object {
        const val MINUTES_PER_HOUR = 60
        const val SECONDS_PER_MINUTE = 60L
        const val DAYS_PER_WEEK = 7

        /** Sunucu bu dilimi göndermezse: iş kuralı Türkiye, son çare GMT. */
        const val FALLBACK_ZONE = "Europe/Istanbul"

        val DATE_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy, HH:mm", TrLocale)
        val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy", TrLocale)
        val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", TrLocale)
        val WEEKDAY_INITIAL: DateTimeFormatter = DateTimeFormatter.ofPattern("EEEEE", TrLocale)
        val DAY_NUMBER: DateTimeFormatter = DateTimeFormatter.ofPattern("d", TrLocale)
        val WIRE: DateTimeFormatter = DateTimeFormatter.ISO_OFFSET_DATE_TIME

        fun resolveZone(identifier: String?): ZoneId {
            if (identifier != null) {
                runCatching { return ZoneId.of(identifier) }
            }
            return runCatching { ZoneId.of(FALLBACK_ZONE) }.getOrElse { ZoneId.of("GMT") }
        }
    }
}
