package com.klinara.android.services.scheduling

import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import kotlin.random.Random

/**
 * Mock çalışma saatleri, programlar ve istisnalar (A7.3).
 *
 * Sunucunun **doğrulamalarını taklit eder**: tam 7 benzersiz gün, kapalı/izinli günde saat
 * yok, açık günde iki saat de şart, mola ikisi birlikte (400); sıralama ihlalleri
 * (açılış ≥ kapanış, mola dışarıda) sunucuda yalnız DB CHECK'te ve **yanıltıcı başlıklı bir
 * 409** dönüyor — mock da öyle yapıyor ki istemcinin kendi doğrulaması o yola hiç
 * düşmediği test edilebilsin. İstisna listesi sunucu gibi `from`/`to`'yu yalnız `startsAt`
 * ile karşılaştırıyor: mock'ta daha "doğru" bir süzgeç, canlıda görünmeyen bir satırı
 * mock'ta gösterirdi.
 *
 * Randevu motoru [workingIntervals] ile okur: şube saatleri ∩ personel programı − mola −
 * istisnalar. Sunucunun uygunluk motoru (`availability.repository.ts`) ile aynı kural.
 */
@Suppress("TooManyFunctions")
class MockSchedulingService(
    private val clock: BranchClock = BranchClock("Europe/Istanbul"),
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    now: Instant = Instant.now(),
) : SchedulingService {
    var failing: Boolean = false

    private val hours: MutableMap<String, List<BranchHour>> =
        mutableMapOf(
            MockIds.BRANCH_NISANTASI to seedBranch(MockIds.BRANCH_NISANTASI),
            MockIds.BRANCH_BODRUM to seedBranch(MockIds.BRANCH_BODRUM),
        )
    private val schedules: MutableMap<Pair<String, String>, List<StaffScheduleEntry>> = seedSchedules()
    private val exceptionRecords: MutableList<ScheduleException> = seedExceptions(now).toMutableList()
    private var idCounter = 0

    // --- Şube saatleri ---

    override suspend fun branchHours(branchId: String): BranchHours {
        settle()
        return BranchHours(branchId, hours[branchId].orEmpty().sortedBy { it.dayOfWeek })
    }

    override suspend fun replaceBranchHours(
        branchId: String,
        entries: List<BranchHourInput>,
    ): BranchHours {
        settle()
        requireFullWeek(entries.map { it.dayOfWeek })
        entries.forEach { entry ->
            val times = listOfNotNull(entry.open, entry.close, entry.breakStart, entry.breakEnd)
            when {
                entry.isClosed && times.isNotEmpty() ->
                    throw MockErrors.validation("entries", "Kapalı günde saat olmaz")
                !entry.isClosed && (entry.open == null || entry.close == null) ->
                    throw MockErrors.validation("entries", "Açık günde açılış ve kapanış gerekli")
                (entry.breakStart == null) != (entry.breakEnd == null) ->
                    throw MockErrors.validation("entries", "Mola başlangıcı ve bitişi birlikte verilir")
            }
            if (!entry.isClosed && !ordered(entry)) throw misleadingCheckConflict("Şube bu kiracıya ait değil")
        }
        hours[branchId] =
            entries.map {
                BranchHour(
                    id = nextId(),
                    branchId = branchId,
                    dayOfWeek = it.dayOfWeek,
                    isClosed = it.isClosed,
                    openTime = it.open.server(),
                    closeTime = it.close.server(),
                    breakStartTime = it.breakStart.server(),
                    breakEndTime = it.breakEnd.server(),
                )
            }
        return BranchHours(branchId, hours.getValue(branchId).sortedBy { it.dayOfWeek })
    }

    // --- Personel programı ---

    override suspend fun staffSchedule(
        staffProfileId: String,
        branchId: String,
    ): StaffSchedule {
        settle()
        return StaffSchedule(staffProfileId, branchId, schedules[staffProfileId to branchId].orEmpty())
    }

    override suspend fun replaceStaffSchedule(
        staffProfileId: String,
        branchId: String,
        entries: List<StaffScheduleEntryInput>,
    ): StaffSchedule {
        settle()
        requireFullWeek(entries.map { it.dayOfWeek })
        entries.forEach { entry ->
            when {
                entry.isOff && (entry.start != null || entry.end != null) ->
                    throw MockErrors.validation("entries", "İzinli günde saat olmaz")
                !entry.isOff && (entry.start == null || entry.end == null) ->
                    throw MockErrors.validation("entries", "Çalışma gününde başlangıç ve bitiş gerekli")
            }
            val start = entry.start
            val end = entry.end
            if (start != null && end != null && start >= end) {
                throw misleadingCheckConflict("Personel profili ve şube bu kiracıya ait olmalı")
            }
        }
        val stored =
            entries.sortedBy { it.dayOfWeek }.map {
                StaffScheduleEntry(
                    id = nextId(),
                    staffProfileId = staffProfileId,
                    branchId = branchId,
                    dayOfWeek = it.dayOfWeek,
                    isOff = it.isOff,
                    startTime = it.start.server(),
                    endTime = it.end.server(),
                )
            }
        schedules[staffProfileId to branchId] = stored
        return StaffSchedule(staffProfileId, branchId, stored)
    }

    // --- İstisnalar ---

    override suspend fun exceptions(query: ScheduleExceptionQuery): List<ScheduleException> {
        settle()
        return exceptionRecords
            .filter { it.isActive && it.branchId == query.branchId }
            .filter { query.staffProfileId == null || it.staffProfileId == query.staffProfileId }
            // Sunucu gibi: YALNIZ `startsAt` karşılaştırılıyor, örtüşme değil.
            .filter { query.from == null || it.startsAt >= query.from }
            .filter { query.to == null || it.startsAt <= query.to }
            .sortedBy { it.startsAt }
    }

    override suspend fun createException(input: ScheduleExceptionInput): ScheduleException {
        settle()
        val startsAt = parse(input.startsAt, "startsAt")
        val endsAt = parse(input.endsAt, "endsAt")
        val until = input.recurrenceUntil?.let { parse(it, "recurrenceUntil") }
        if (endsAt <= startsAt) throw MockErrors.validation("endsAt", "Bitiş başlangıçtan sonra olmalı")
        when (input.recurrenceType) {
            ScheduleRecurrence.Weekly -> {
                if (until == null) {
                    throw MockErrors.validation("recurrenceUntil", "Haftalık tekrarda bitiş tarihi gerekli")
                }
                if (input.recurrenceWeekdays.isEmpty()) {
                    throw MockErrors.validation("recurrenceWeekdays", "En az bir gün seçin")
                }
                if (until <= startsAt) throw misleadingCheckConflict("Personel profili ve şube bu kiracıya ait olmalı")
            }
            else ->
                if (until != null || input.recurrenceWeekdays.isNotEmpty()) {
                    throw MockErrors.validation("recurrenceType", "Tek seferlik istisnada tekrar alanı olmaz")
                }
        }
        val created =
            ScheduleException(
                id = nextId(),
                tenantId = MockIds.TENANT_NISANTASI,
                staffProfileId = input.staffProfileId,
                branchId = input.branchId,
                startsAt = startsAt,
                endsAt = endsAt,
                reason = input.reason,
                recurrenceType = input.recurrenceType,
                recurrenceIntervalWeeks = input.recurrenceIntervalWeeks ?: 1,
                recurrenceUntil = until,
                recurrenceWeekdays = input.recurrenceWeekdays.sorted(),
            )
        exceptionRecords += created
        return created
    }

    override suspend fun deleteException(id: String) {
        settle()
        val index = exceptionRecords.indexOfFirst { it.id == id && it.isActive }
        if (index < 0) throw MockErrors.notFound("İstisna")
        exceptionRecords[index] = exceptionRecords[index].copy(isActive = false)
    }

    // --- Randevu motoru için ---

    /**
     * [day] gününde personelin [branchId]'de ÇALIŞABİLDİĞİ aralıklar: şube saatleri ∩
     * personel programı − mola − istisnalar. Kapalı gün, izinli gün ya da hiç program kaydı
     * yoksa boş (sunucu: programı olmayan personele slot yok). Gece yarısını geçen aralık yok.
     */
    fun workingIntervals(
        staffProfileId: String,
        branchId: String,
        day: Instant,
    ): List<ClosedRange<Instant>> {
        val date = day.atZone(clock.zone).toLocalDate()
        val dow = Weekday.of(date.dayOfWeek).dow
        val branchDay = hours[branchId]?.firstOrNull { it.dayOfWeek == dow }
        val staffDay = schedules[staffProfileId to branchId]?.firstOrNull { it.dayOfWeek == dow }
        val window = openWindow(branchDay, staffDay) ?: return emptyList()

        val dayStart = clock.startOfDay(day)
        fun at(range: ClosedRange<ClockTime>) =
            clock.date(dayStart, range.start)..clock.date(dayStart, range.endInclusive)
        var intervals = listOf(at(window))
        branchDay?.breakRange?.let { intervals = intervals.minus(at(it)) }
        exceptionRecords
            .filter { it.isActive && it.staffProfileId == staffProfileId && it.branchId == branchId }
            .flatMap { occurrencesOn(it, date) }
            .forEach { busy -> intervals = intervals.minus(busy) }
        return intervals
    }

    /** Şube açık saatleri ∩ personel saatleri; kapalı/izinli/kayıtsız günde `null`. */
    private fun openWindow(
        branchDay: BranchHour?,
        staffDay: StaffScheduleEntry?,
    ): ClosedRange<ClockTime>? {
        val working = branchDay?.isClosed == false && staffDay?.isOff == false
        if (!working) return null
        val opens = listOfNotNull(branchDay.open, staffDay.start)
        val closes = listOfNotNull(branchDay.close, staffDay.end)
        if (opens.size != 2 || closes.size != 2) return null
        return (opens.max()..closes.min()).takeIf { it.start < it.endInclusive }
    }

    /**
     * Bir istisnanın [date] gününe düşen örnekleri. Haftalık tekrar **şube yerel tarihinde**
     * açılır ve `startsAt`'in yerel saatini korur (DST'de kaymaz); aralık ilk örneğin ISO
     * haftasından sayılır — sunucunun `availability.repository.ts` kuralı.
     */
    internal fun occurrencesOn(
        exception: ScheduleException,
        date: LocalDate,
    ): List<ClosedRange<Instant>> =
        if (exception.recurrenceType == ScheduleRecurrence.Weekly) {
            weeklyOn(exception, date)
        } else {
            oneOffOn(exception, date)
        }

    private fun oneOffOn(
        exception: ScheduleException,
        date: LocalDate,
    ): List<ClosedRange<Instant>> {
        val dayStart = date.atStartOfDay(clock.zone).toInstant()
        val dayEnd = date.plusDays(1).atStartOfDay(clock.zone).toInstant()
        val touches = exception.startsAt < dayEnd && exception.endsAt > dayStart
        return listOfNotNull((exception.startsAt..exception.endsAt).takeIf { touches })
    }

    private fun weeklyOn(
        exception: ScheduleException,
        date: LocalDate,
    ): List<ClosedRange<Instant>> {
        val first = exception.startsAt.atZone(clock.zone)
        val until = exception.recurrenceUntil?.atZone(clock.zone)?.toLocalDate()
        val weeks =
            ChronoUnit.WEEKS.between(
                first.toLocalDate().with(TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)),
                date.with(TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)),
            )
        val onPattern =
            until != null && date >= first.toLocalDate() && date <= until &&
                Weekday.of(date.dayOfWeek).dow in exception.recurrenceWeekdays &&
                weeks % exception.recurrenceIntervalWeeks.coerceAtLeast(1) == 0L
        if (!onPattern) return emptyList()
        val start = date.atTime(first.toLocalTime()).atZone(clock.zone).toInstant()
        return listOf(start..start.plus(Duration.between(exception.startsAt, exception.endsAt)))
    }

    // --- Kurallar ---

    private fun requireFullWeek(days: List<Int>) {
        if (days.size != Weekday.DAYS_IN_WEEK || days.toSet() != (0 until Weekday.DAYS_IN_WEEK).toSet()) {
            throw MockErrors.validation("entries", "Haftanın yedi günü birer kez verilmeli")
        }
    }

    private fun ordered(entry: BranchHourInput): Boolean {
        val open = entry.open ?: return false
        val close = entry.close ?: return false
        if (open >= close) return false
        val breakStart = entry.breakStart ?: return true
        val breakEnd = entry.breakEnd ?: return true
        return open <= breakStart && breakStart < breakEnd && breakEnd <= close
    }

    /** Sunucu sıralama kurallarını yalnız DB CHECK'te tutuyor; hata genel bir 409 ve başlığı alakasız. */
    private fun misleadingCheckConflict(title: String): ApiError.Problem = MockErrors.conflict(title)

    private fun parse(
        value: String,
        path: String,
    ): Instant =
        runCatching { OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant() }
            .getOrElse { throw MockErrors.validation(path, "Geçerli bir tarih girin") }

    private fun nextId(): String {
        idCounter += 1
        return "5c4ed000-0000-4000-8000-%012d".format(idCounter)
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    // --- Tohum ---

    /** Pazartesi–Cumartesi 09:00–19:00, 13:00–14:00 mola; Pazar kapalı (iOS tohumu). */
    private fun seedBranch(branchId: String): List<BranchHour> =
        (0 until Weekday.DAYS_IN_WEEK).map { dow ->
            if (dow == Weekday.Sunday.dow) {
                BranchHour(id = "h-$branchId-$dow", branchId = branchId, dayOfWeek = dow, isClosed = true)
            } else {
                BranchHour(
                    id = "h-$branchId-$dow",
                    branchId = branchId,
                    dayOfWeek = dow,
                    openTime = "09:00:00",
                    closeTime = "19:00:00",
                    breakStartTime = "13:00:00",
                    breakEndTime = "14:00:00",
                )
            }
        }

    private fun seedSchedules(): MutableMap<Pair<String, String>, List<StaffScheduleEntry>> =
        mutableMapOf(
            (MockIds.STAFF_DERYA to MockIds.BRANCH_NISANTASI) to week("09:00", "18:00", off = setOf(Weekday.Sunday)),
            // Merve Çarşamba izinli: program ekranında "İzinli" satırı ve o gün slotsuz bir personel.
            (MockIds.STAFF_MERVE to MockIds.BRANCH_NISANTASI) to
                week("10:00", "19:00", off = setOf(Weekday.Sunday, Weekday.Wednesday)),
            (MockIds.STAFF_ONUR to MockIds.BRANCH_NISANTASI) to
                week("09:00", "17:00", off = setOf(Weekday.Saturday, Weekday.Sunday)),
            // Bodrum'da yalnız Onur: iki şubede çalışan personelin iki ayrı programı var.
            (MockIds.STAFF_ONUR to MockIds.BRANCH_BODRUM) to
                week("10:00", "16:00", off = Weekday.entries.toSet() - Weekday.Saturday),
        ).mapValues { (key, entries) ->
            entries.map { it.copy(staffProfileId = key.first, branchId = key.second) }
        }.toMutableMap()

    private fun week(
        start: String,
        end: String,
        off: Set<Weekday>,
    ): List<StaffScheduleEntry> =
        Weekday.entries.map { day ->
            if (day in off) {
                StaffScheduleEntry(dayOfWeek = day.dow, isOff = true)
            } else {
                StaffScheduleEntry(dayOfWeek = day.dow, startTime = "$start:00", endTime = "$end:00")
            }
        }

    private fun seedExceptions(now: Instant): List<ScheduleException> {
        val today = clock.startOfDay(now)
        val leaveStart = clock.date(clock.adding(LEAVE_OFFSET_DAYS, today), ClockTime(LEAVE_HOUR, 0))
        val trainingDay = clock.adding(1L, today)
        val trainingStart = clock.date(trainingDay, ClockTime(TRAINING_HOUR, 0))
        return listOf(
            ScheduleException(
                id = "5c4ed000-0000-4000-8000-000000000901",
                staffProfileId = MockIds.STAFF_DERYA,
                branchId = MockIds.BRANCH_NISANTASI,
                startsAt = leaveStart,
                endsAt = clock.adding(LEAVE_LENGTH_DAYS, leaveStart),
                reason = "Yıllık izin",
            ),
            // Haftalık tekrar, yarının gününde: ekranda tekrar rozeti ve o saatte slotsuz Merve.
            ScheduleException(
                id = "5c4ed000-0000-4000-8000-000000000902",
                staffProfileId = MockIds.STAFF_MERVE,
                branchId = MockIds.BRANCH_NISANTASI,
                startsAt = trainingStart,
                endsAt = clock.addingMinutes(TRAINING_MINUTES, trainingStart),
                reason = "Eğitim",
                recurrenceType = ScheduleRecurrence.Weekly,
                recurrenceUntil = clock.adding(TRAINING_WEEKS_DAYS, trainingStart),
                recurrenceWeekdays = listOf(Weekday.of(trainingDay.atZone(clock.zone).dayOfWeek).dow),
            ),
        )
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val LEAVE_OFFSET_DAYS = 7L
        const val LEAVE_HOUR = 9
        const val LEAVE_LENGTH_DAYS = 3L
        const val TRAINING_HOUR = 15
        const val TRAINING_MINUTES = 90L
        const val TRAINING_WEEKS_DAYS = 56L
    }
}

private fun ClockTime?.server(): String? = this?.let { "${it.wireValue}:00" }

/** Aralık listesinden [busy]'yi çıkarır — kalan parçalar. */
internal fun List<ClosedRange<Instant>>.minus(busy: ClosedRange<Instant>): List<ClosedRange<Instant>> =
    flatMap { range ->
        if (busy.endInclusive <= range.start || busy.start >= range.endInclusive) {
            listOf(range)
        } else {
            listOfNotNull(
                (range.start..busy.start).takeIf { busy.start > range.start },
                (busy.endInclusive..range.endInclusive).takeIf { busy.endInclusive < range.endInclusive },
            )
        }
    }
