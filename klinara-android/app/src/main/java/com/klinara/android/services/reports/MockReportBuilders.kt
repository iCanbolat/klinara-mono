package com.klinara.android.services.reports

import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.reports.MockReportsData.Shift
import com.klinara.android.services.reports.MockReportsData.Status
import com.klinara.android.services.reports.MockReportsData.Visit
import java.time.LocalDate
import kotlin.math.roundToLong

/**
 * Ham vardiya/ziyaretten rapor satırları — sunucunun `modules/reporting` servislerinin
 * TOPLAMA KURALLARININ aynası (mock'un işi; istemci ekranları bunların hiçbirini hesaplamaz):
 *
 * - toplam oran satır oranlarının ortalaması DEĞİL, toplam pay / toplam payda;
 * - iptal edilen randevunun dakikası dolu sayılmaz, gelmeyeninki sayılır (slot yine tutuldu);
 * - gelmeme grain'i randevu; ciro tamamlanan kalem;
 * - sıralamalar sunucudaki `order by`'lar.
 */
internal object MockReportBuilders {
    // --- Doluluk ---

    fun occupancyRows(
        shifts: List<Shift>,
        visits: List<Visit>,
        groupBy: OccupancyGrouping,
    ): List<OccupancyRow> {
        val available = shifts.groupBy { occupancyKey(groupBy, it.staffId, it.staffName, it.branchId, it.date) }
        val booked =
            visits
                .filter(::occupiesSlot)
                .groupBy { occupancyKey(groupBy, it.staffId, it.staffName, it.branchId, it.date) }
        return (available.keys + booked.keys)
            .map { key ->
                occupancyRow(
                    key,
                    booked[key].orEmpty().sumOf { it.minutes },
                    available[key].orEmpty().sumOf { it.minutes },
                )
            }.sortedWith(
                if (groupBy == OccupancyGrouping.Day) {
                    compareBy { it.groupLabel }
                } else {
                    compareByDescending<OccupancyRow> { it.bookedMinutes }.thenBy { it.groupLabel }
                },
            )
    }

    fun occupancyTotals(rows: List<OccupancyRow>): OccupancyTotals {
        val booked = rows.sumOf { it.bookedMinutes }
        val available = rows.sumOf { it.availableMinutes }
        return OccupancyTotals(booked, available, rate(booked.toLong(), available.toLong()))
    }

    // --- Ciro ---

    fun revenueRows(
        visits: List<Visit>,
        groupBy: RevenueGrouping,
    ): List<RevenueRow> {
        return visits
            .filter { it.status == Status.Completed }
            .groupBy { revenueKey(groupBy, it) }
            .map { (key, rows) ->
                RevenueRow(key.first, key.second, rows.sumOf { it.priceMinor })
            }.sortedWith(compareByDescending<RevenueRow> { it.accruedMinor }.thenBy { it.groupLabel })
    }

    fun revenueTotals(visits: List<Visit>): RevenueTotals =
        RevenueTotals(
            accruedMinor = visits.filter { it.status == Status.Completed }.sumOf { it.priceMinor },
        )

    // --- Personel performansı ---

    fun staffRows(
        shifts: List<Shift>,
        visits: List<Visit>,
    ): List<StaffPerformanceRow> {
        val names = (shifts.map { it.staffId to it.staffName } + visits.map { it.staffId to it.staffName }).toMap()
        return names
            .map { (id, name) ->
                val own = visits.filter { it.staffId == id }
                val completed = own.filter { it.status == Status.Completed }
                val revenue = completed.sumOf { it.priceMinor }
                val booked = own.filter(::occupiesSlot).sumOf { it.minutes }
                val available = shifts.filter { it.staffId == id }.sumOf { it.minutes }
                StaffPerformanceRow(
                    staffProfileId = id,
                    staffName = name,
                    completedServices = completed.size,
                    revenueMinor = revenue,
                    bookedMinutes = booked,
                    availableMinutes = available,
                    occupancyRate = rate(booked.toLong(), available.toLong()),
                )
            }.sortedWith(compareByDescending<StaffPerformanceRow> { it.revenueMinor }.thenBy { it.staffName })
    }

    // --- Gelmeme ---

    fun noShowRows(
        visits: List<Visit>,
        groupBy: NoShowGrouping,
    ): List<NoShowRow> =
        visits
            .groupBy { noShowKey(groupBy, it) }
            .map { (key, rows) ->
                val totals = noShowTotals(rows)
                NoShowRow(
                    groupId = key.first,
                    groupLabel = key.second,
                    total = totals.total,
                    completed = totals.completed,
                    noShow = totals.noShow,
                    cancelled = totals.cancelled,
                    noShowRate = totals.noShowRate,
                    cancellationRate = totals.cancellationRate,
                )
            }.sortedWith(compareByDescending<NoShowRow> { it.noShow }.thenBy { it.groupLabel })

    fun noShowTotals(visits: List<Visit>): NoShowTotals {
        val noShow = visits.count { it.status == Status.NoShow }
        val cancelled = visits.count { it.status == Status.Cancelled }
        return NoShowTotals(
            total = visits.size,
            completed = visits.count { it.status == Status.Completed },
            noShow = noShow,
            cancelled = cancelled,
            noShowRate = rate(noShow.toLong(), visits.size.toLong()),
            cancellationRate = rate(cancelled.toLong(), visits.size.toLong()),
        )
    }

    fun byOrigin(visits: List<Visit>): List<NoShowByOrigin> =
        visits
            .groupBy { if (it.isOnline) "online" else "internal" }
            .toSortedMap()
            .map { (origin, rows) ->
                val totals = noShowTotals(rows)
                NoShowByOrigin(
                    origin = origin,
                    total = totals.total,
                    completed = totals.completed,
                    noShow = totals.noShow,
                    cancelled = totals.cancelled,
                    noShowRate = totals.noShowRate,
                    cancellationRate = totals.cancellationRate,
                )
            }

    // --- Kazanım ---

    /**
     * "Yeni müşteri" İLK TAMAMLANMIŞ ziyarete göre (kayıt tarihine göre değil); ilk ziyaret
     * pencerenin dışına, açılışa kadar geriye bakılarak bulunur.
     */
    fun retention(
        history: List<Visit>,
        window: Set<LocalDate>,
        today: LocalDate,
        source: (Int) -> String?,
    ): Triple<RetentionTotals, List<AcquisitionRow>, List<CohortReturn>> {
        val completed = history.filter { it.status == Status.Completed }
        val visitsByCustomer =
            completed.groupBy { it.customer }.mapValues { (_, rows) -> rows.map { it.date }.sorted() }
        val active = completed.filter { it.date in window }.map { it.customer }.toSet()
        val newcomers = visitsByCustomer.filterValues { it.first() in window }
        val returning = active - newcomers.keys

        val acquisition =
            newcomers.keys
                .groupingBy(source)
                .eachCount()
                .map { (raw, count) -> AcquisitionRow(raw, count) }
                .sortedWith(compareByDescending<AcquisitionRow> { it.customers }.thenBy(nullsLast()) { it.source })

        val cohorts =
            COHORT_DAYS.map { days ->
                val returned =
                    newcomers.count { (_, dates) ->
                        val first = dates.first()
                        val until = minOf(first.plusDays(days.toLong()), today)
                        dates.drop(1).any { it.isAfter(first) && !it.isAfter(until) }
                    }
                CohortReturn(days, returned, rate(returned.toLong(), newcomers.size.toLong()))
            }

        val totals =
            RetentionTotals(
                newCustomers = newcomers.size,
                returningCustomers = returning.size,
                activeCustomers = active.size,
                returningRate = rate(returning.size.toLong(), active.size.toLong()),
            )
        return Triple(totals, acquisition, cohorts)
    }
}

// --- Karşılaştırma: sunucunun `delta` anahtar kümeleri (rapora göre değişir) ---

internal fun OccupancyTotals.delta(previous: OccupancyTotals): ReportDelta =
    mapOf(
        "bookedMinutes" to percentDelta(bookedMinutes, previous.bookedMinutes),
        "availableMinutes" to percentDelta(availableMinutes, previous.availableMinutes),
        "occupancyRate" to percentDelta(occupancyRate, previous.occupancyRate),
    )

internal fun RevenueTotals.delta(previous: RevenueTotals): ReportDelta =
    mapOf(
        "accruedMinor" to percentDelta(accruedMinor, previous.accruedMinor),
    )

internal fun NoShowTotals.delta(previous: NoShowTotals): ReportDelta =
    mapOf(
        "total" to percentDelta(total, previous.total),
        "noShow" to percentDelta(noShow, previous.noShow),
        "noShowRate" to percentDelta(noShowRate, previous.noShowRate),
        "cancellationRate" to percentDelta(cancellationRate, previous.cancellationRate),
    )

internal fun RetentionTotals.delta(previous: RetentionTotals): ReportDelta =
    mapOf(
        "newCustomers" to percentDelta(newCustomers, previous.newCustomers),
        "returningCustomers" to percentDelta(returningCustomers, previous.returningCustomers),
        "activeCustomers" to percentDelta(activeCustomers, previous.activeCustomers),
    )

// --- Ortak ---

/** Sunucunun `rate`'i: yüzde, iki hane; payda 0 ise 0. */
private fun rate(
    part: Long,
    whole: Long,
): Double = if (whole == 0L) 0.0 else (part * PERCENT_SCALE.toDouble() / whole).roundToLong() / HUNDRED

/** Sunucunun `percentDelta`'sı: önceki 0 → bu dönem de 0 ise 0, değilse `null` (kıyaslanamaz). */
private fun percentDelta(
    current: Number,
    previous: Number,
): Double? {
    val now = current.toDouble()
    val before = previous.toDouble()
    return when {
        before == 0.0 -> if (now == 0.0) 0.0 else null
        else -> ((now - before) / before * PERCENT_SCALE).roundToLong() / HUNDRED
    }
}

private fun occupiesSlot(visit: Visit): Boolean = visit.status != Status.Cancelled

private fun occupancyRow(
    key: Pair<String?, String>,
    booked: Int,
    available: Int,
) = OccupancyRow(key.first, key.second, booked, available, rate(booked.toLong(), available.toLong()))

private fun occupancyKey(
    groupBy: OccupancyGrouping,
    staffId: String,
    staffName: String,
    branchId: String,
    date: LocalDate,
): Pair<String?, String> =
    when (groupBy) {
        OccupancyGrouping.Staff -> staffId to staffName
        OccupancyGrouping.Branch -> branchId to branchName(branchId)
        OccupancyGrouping.Day -> null to date.toString()
    }

private fun revenueKey(
    groupBy: RevenueGrouping,
    visit: Visit,
): Pair<String?, String> =
    when (groupBy) {
        RevenueGrouping.Service -> visit.serviceId to visit.serviceName
        RevenueGrouping.Package -> visit.packageName?.let { PACKAGE_GROUP_ID to it } ?: (null to "—")
        RevenueGrouping.Staff -> visit.staffId to visit.staffName
        RevenueGrouping.Branch -> visit.branchId to branchName(visit.branchId)
        RevenueGrouping.Day -> null to visit.date.toString()
    }

private fun noShowKey(
    groupBy: NoShowGrouping,
    visit: Visit,
): Pair<String?, String> =
    when (groupBy) {
        NoShowGrouping.Staff -> visit.staffId to visit.staffName
        NoShowGrouping.Branch -> visit.branchId to branchName(visit.branchId)
        NoShowGrouping.Service -> visit.serviceId to visit.serviceName
        NoShowGrouping.Day -> null to visit.date.toString()
    }

private fun branchName(id: String): String =
    when (id) {
        MockIds.BRANCH_NISANTASI -> "Nişantaşı"
        MockIds.BRANCH_BODRUM -> "Bodrum"
        else -> "Şube"
    }

private const val PERCENT_SCALE = 10_000
private const val HUNDRED = 100.0
private const val PACKAGE_GROUP_ID = "9ac00000-0000-4000-8000-000000000001"
private const val COHORT_30 = 30
private const val COHORT_60 = 60
private const val COHORT_90 = 90
private val COHORT_DAYS = listOf(COHORT_30, COHORT_60, COHORT_90)

