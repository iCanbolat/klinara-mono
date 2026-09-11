package com.klinara.android.features.scheduling

import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.scheduling.BranchHourInput
import com.klinara.android.services.scheduling.BranchHours
import com.klinara.android.services.scheduling.StaffSchedule
import com.klinara.android.services.scheduling.StaffScheduleEntryInput
import com.klinara.android.services.scheduling.Weekday
import java.time.LocalTime

/**
 * Şube haftası taslağı — iOS `BranchHoursView.DayDraft` paritesi, saf değer tipi.
 *
 * **iOS'tan fark: istemci doğrulaması.** Sunucu sıralama kurallarını (açılış < kapanış, mola
 * açık saatlerin içinde) yalnız DB CHECK'te tutuyor ve ihlal **alakasız başlıklı bir 409**
 * dönüyor ("Şube bu kiracıya ait değil"). iOS doğrulamadığı için kullanıcı o metni görüyor.
 * Burada her gün kendi hatasını taşıyor ve hatalı taslak gönderilmiyor.
 */
data class WeekHoursDraft(
    val days: Map<Weekday, Day>,
    private val original: Map<Weekday, Day> = days,
) {
    data class Day(
        val isClosed: Boolean = false,
        val open: ClockTime = DEFAULT_OPEN,
        val close: ClockTime = DEFAULT_CLOSE,
        val hasBreak: Boolean = false,
        val breakStart: ClockTime = DEFAULT_BREAK_START,
        val breakEnd: ClockTime = DEFAULT_BREAK_END,
    ) {
        /** Günün doğrulama hatası; kapalı gün her zaman geçerli. */
        val error: String?
            get() =
                when {
                    isClosed -> null
                    open >= close -> "Kapanış açılıştan sonra olmalı."
                    hasBreak && breakStart >= breakEnd -> "Mola bitişi başlangıcından sonra olmalı."
                    hasBreak && (breakStart < open || breakEnd > close) -> "Mola açık saatlerin içinde olmalı."
                    else -> null
                }

        fun input(dayOfWeek: Int): BranchHourInput =
            if (isClosed) {
                BranchHourInput(dayOfWeek = dayOfWeek, isClosed = true)
            } else {
                BranchHourInput(
                    dayOfWeek = dayOfWeek,
                    isClosed = false,
                    open = open,
                    close = close,
                    breakStart = breakStart.takeIf { hasBreak },
                    breakEnd = breakEnd.takeIf { hasBreak },
                )
            }
    }

    fun day(weekday: Weekday): Day = days[weekday] ?: Day()

    val isDirty: Boolean get() = days != original

    val isValid: Boolean get() = Weekday.entries.all { day(it).error == null }

    fun update(
        weekday: Weekday,
        transform: (Day) -> Day,
    ): WeekHoursDraft = copy(days = days + (weekday to transform(day(weekday))))

    /** "Bu saatleri tüm günlere uygula" — yalnız AÇIK günlere (iOS gibi); kapalı gün kapalı kalır. */
    fun applyToOpenDays(source: Weekday): WeekHoursDraft {
        val template = day(source)
        return copy(days = days.mapValues { (_, day) -> if (day.isClosed) day else template.copy(isClosed = false) })
    }

    /** `PUT` gövdesi — daima 7 gün. */
    fun inputs(): List<BranchHourInput> = Weekday.entries.map { day(it).input(it.dow) }

    companion object {
        val DEFAULT_OPEN = ClockTime(9, 0)
        val DEFAULT_CLOSE = ClockTime(18, 0)
        val DEFAULT_BREAK_START = ClockTime(13, 0)
        val DEFAULT_BREAK_END = ClockTime(14, 0)

        /** Kaydı olmayan gün açık 09:00–18:00, molasız (iOS varsayılanı). */
        fun of(hours: BranchHours): WeekHoursDraft {
            val days =
                Weekday.entries.associateWith { weekday ->
                    val entry = hours.entries.firstOrNull { it.dayOfWeek == weekday.dow }
                    if (entry == null) {
                        Day()
                    } else {
                        val breakStart = entry.breakStart
                        val breakEnd = entry.breakEnd
                        Day(
                            isClosed = entry.isClosed,
                            open = entry.open ?: DEFAULT_OPEN,
                            close = entry.close ?: DEFAULT_CLOSE,
                            hasBreak = breakStart != null && breakEnd != null,
                            breakStart = breakStart ?: DEFAULT_BREAK_START,
                            breakEnd = breakEnd ?: DEFAULT_BREAK_END,
                        )
                    }
                }
            return WeekHoursDraft(days)
        }
    }
}

/** Personelin bir şubedeki haftası — iOS `StaffScheduleView` taslağı. Anahtar "çalışıyor" (`isOff`'un tersi). */
data class StaffWeekDraft(
    val days: Map<Weekday, Day>,
    private val original: Map<Weekday, Day> = days,
) {
    data class Day(
        val isWorking: Boolean = true,
        val start: ClockTime = DEFAULT_START,
        val end: ClockTime = DEFAULT_END,
    ) {
        val error: String? get() = if (isWorking && start >= end) "Bitiş başlangıçtan sonra olmalı." else null

        fun input(dayOfWeek: Int): StaffScheduleEntryInput =
            if (isWorking) {
                StaffScheduleEntryInput(dayOfWeek = dayOfWeek, isOff = false, start = start, end = end)
            } else {
                StaffScheduleEntryInput(dayOfWeek = dayOfWeek, isOff = true)
            }
    }

    fun day(weekday: Weekday): Day = days[weekday] ?: Day()

    val isDirty: Boolean get() = days != original

    val isValid: Boolean get() = Weekday.entries.all { day(it).error == null }

    fun update(
        weekday: Weekday,
        transform: (Day) -> Day,
    ): StaffWeekDraft = copy(days = days + (weekday to transform(day(weekday))))

    fun inputs(): List<StaffScheduleEntryInput> = Weekday.entries.map { day(it).input(it.dow) }

    companion object {
        val DEFAULT_START = ClockTime(10, 0)
        val DEFAULT_END = ClockTime(18, 0)

        /**
         * Kaydı olmayan gün "çalışıyor 10:00–18:00" (iOS varsayılanı). ⚠️ Sunucuda kaydı olmayan
         * gün **çalışmıyor** demek; ekran bu yüzden hiç programı olmayan personelde "kayıtlı
         * program yok" uyarısı veriyor — kaydedilene kadar varsayılan yalnız bir öneri.
         */
        fun of(schedule: StaffSchedule): StaffWeekDraft {
            val days =
                Weekday.entries.associateWith { weekday ->
                    val entry = schedule.entries.firstOrNull { it.dayOfWeek == weekday.dow }
                    if (entry == null) {
                        Day()
                    } else {
                        Day(
                            isWorking = !entry.isOff,
                            start = entry.start ?: DEFAULT_START,
                            end = entry.end ?: DEFAULT_END,
                        )
                    }
                }
            return StaffWeekDraft(days)
        }
    }
}

fun ClockTime.toLocalTime(): LocalTime = LocalTime.of(hour, minute)

fun LocalTime.toClockTime(): ClockTime = ClockTime(hour, minute)
