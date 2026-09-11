package com.klinara.android.features.scheduling

import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.scheduling.ScheduleExceptionInput
import com.klinara.android.services.scheduling.ScheduleRecurrence
import java.time.Instant
import java.time.LocalDate

/**
 * Yeni istisna taslağı — iOS `ScheduleExceptionEditorView` paritesi, saf değer tipi.
 *
 * Tarih ve saat **şubenin duvar saatinde** tutulur (`LocalDate` + [ClockTime]); kabloya
 * giderken [clock] ile şube offset'li ISO'ya çevrilir. Cihaz diliminde bir `Instant` tutmak,
 * seyahat eden yöneticinin izni bir saat kaydırarak kaydetmesi demekti.
 *
 * Yalnız OLUŞTURMA: sunucuda PATCH yok ve arayüz "düzenle"yi sil+oluştur ile taklit etmez.
 */
data class ScheduleExceptionDraft(
    val clock: BranchClock,
    val staffProfileId: String? = null,
    val startDate: LocalDate,
    val startTime: ClockTime = ClockTime(DEFAULT_START_HOUR, 0),
    val endDate: LocalDate = startDate,
    val endTime: ClockTime = ClockTime(DEFAULT_END_HOUR, 0),
    val reason: String = "",
    val recurrence: ScheduleRecurrence = ScheduleRecurrence.None,
    val weekdays: Set<Int> = emptySet(),
    val intervalWeeks: Int = 1,
    val untilDate: LocalDate = startDate.plusDays(DEFAULT_UNTIL_DAYS),
) {
    val startsAt: Instant get() = clock.instant(startDate, startTime)
    val endsAt: Instant get() = clock.instant(endDate, endTime)

    /**
     * Tekrarın son günü GÜN SONUNA kadar: iOS tarih seçicinin taşıdığı rastgele saati
     * gönderiyor ve o günün öğleden sonraki örneği sessizce düşebiliyor.
     */
    val recurrenceUntil: Instant get() = clock.instant(untilDate, ClockTime(LAST_HOUR, LAST_MINUTE))

    val rangeError: String? get() = if (endsAt <= startsAt) "Bitiş başlangıçtan sonra olmalı." else null

    val recurrenceError: String?
        get() =
            when {
                recurrence != ScheduleRecurrence.Weekly -> null
                weekdays.isEmpty() -> "En az bir gün seçin."
                recurrenceUntil <= endsAt -> "Tekrar bitişi aralığın sonundan sonra olmalı."
                else -> null
            }

    val isValid: Boolean get() = staffProfileId != null && rangeError == null && recurrenceError == null

    /**
     * Başlangıç değişince: bitiş başlangıçtan önceye düştüyse bir saat sonrasına, tekrar
     * bitişi bitişten önceye düştüyse 30 gün sonrasına itilir (iOS kuralı).
     */
    fun withStart(
        date: LocalDate = startDate,
        time: ClockTime = startTime,
    ): ScheduleExceptionDraft {
        var next = copy(startDate = date, startTime = time)
        if (next.endsAt <= next.startsAt) {
            val pushed = clock.addingMinutes(MINUTES_PER_HOUR, next.startsAt)
            next = next.copy(endDate = clock.localDate(pushed), endTime = clock.clockTime(pushed))
        }
        if (!next.untilDate.isAfter(next.endDate)) {
            next = next.copy(untilDate = next.endDate.plusDays(DEFAULT_UNTIL_DAYS))
        }
        return next
    }

    fun toggleWeekday(dow: Int): ScheduleExceptionDraft =
        copy(weekdays = if (dow in weekdays) weekdays - dow else weekdays + dow)

    fun input(branchId: String): ScheduleExceptionInput? {
        val staff = staffProfileId ?: return null
        if (!isValid) return null
        val weekly = recurrence == ScheduleRecurrence.Weekly
        return ScheduleExceptionInput(
            staffProfileId = staff,
            branchId = branchId,
            startsAt = clock.wireValue(startsAt),
            endsAt = clock.wireValue(endsAt),
            reason = reason.trim().ifEmpty { null },
            recurrenceType = recurrence,
            recurrenceIntervalWeeks = intervalWeeks.takeIf { weekly },
            recurrenceUntil = clock.wireValue(recurrenceUntil).takeIf { weekly },
            recurrenceWeekdays = if (weekly) weekdays.sorted() else emptyList(),
        )
    }

    companion object {
        private const val DEFAULT_START_HOUR = 9
        private const val DEFAULT_END_HOUR = 18
        private const val DEFAULT_UNTIL_DAYS = 30L
        private const val MINUTES_PER_HOUR = 60L
        private const val LAST_HOUR = 23
        private const val LAST_MINUTE = 59
        val INTERVAL_RANGE = 1..52

        /** Varsayılan: yarın 09:00–18:00, tekrar yok (iOS). */
        fun initial(
            clock: BranchClock,
            staffProfileId: String?,
            now: Instant = Instant.now(),
        ): ScheduleExceptionDraft {
            val tomorrow = clock.localDate(now).plusDays(1)
            return ScheduleExceptionDraft(clock = clock, staffProfileId = staffProfileId, startDate = tomorrow)
        }
    }
}
