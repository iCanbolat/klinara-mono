package com.klinara.android.features.dashboard

import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.TrLocale
import com.klinara.android.services.reports.NoShowReport
import com.klinara.android.services.reports.OccupancyReport
import com.klinara.android.services.reports.RevenueReport
import com.klinara.android.services.reports.StaffPerformanceReport
import com.klinara.android.services.reports.StaffPerformanceRow
import java.text.Collator
import java.time.Instant

/**
 * Genel bakışın özeti — **saf**, Compose'suz. Web `lib/dashboard/summary.ts` paritesi.
 *
 * Ayrı bir sunucu ucu yok: özet mevcut uçlardan İSTEMCİDE birleştiriliyor (şube başına
 * `calendar/day` + `groupBy=branch` ile üç rapor). Bir kliniğin şube sayısı tek haneli; N+3
 * istek bir uç, DTO ve sözleşme testinden ucuz.
 *
 * Her kaynak AYRI düşebiliyor; eksik veri `null` — "sıfır" değil. Sıfır bir ölçümdür, `null`
 * "bilinmiyor".
 */

/** Hangi bölüm hangi izinle — web `use-dashboard.ts` kapılarının aynısı. */
data class DashboardAccess(
    val calendar: Boolean,
    val occupancy: Boolean,
    val revenue: Boolean,
    val staff: Boolean,
) {
    val isEmpty: Boolean get() = !calendar && !occupancy && !revenue && !staff

    companion object {
        fun of(can: (String) -> Boolean) =
            DashboardAccess(
                calendar = can(Permissions.APPOINTMENT_READ_ALL) || can(Permissions.APPOINTMENT_READ_OWN),
                // Şube kırılımlı doluluk ve gelmeme OPERASYONEL; uygulayıcının `read.own`u şube
                // karşılaştırması açmıyor.
                occupancy = can(Permissions.APPOINTMENT_READ_ALL),
                revenue = can(Permissions.REPORT_REVENUE_READ),
                staff = can(Permissions.REPORT_REVENUE_READ) || can(Permissions.REPORT_PERFORMANCE_READ_OWN),
            )
    }
}

data class DaySummary(
    val total: Int,
    /** Slot kaplayanlar — iptal ve gelmedi hariç. */
    val active: Int,
    val completed: Int,
    /** Henüz başlamamış, slot kaplayan randevular; başlangıca göre sıralı, önizleme kadar kırpılmış. */
    val upcoming: List<CalendarEntry>,
    /** Kırpılmadan önceki bekleyen randevu sayısı — "Tümünü gör (14)" bu sayıdan. */
    val pending: Int = upcoming.size,
)

data class BranchDashboardSummary(
    val branch: BranchSummary,
    /** `null`: takvim izni yok ya da o şubenin günü alınamadı. */
    val today: DaySummary?,
    val timezone: String,
    val occupancyRate: Double?,
    val revenueMinor: Long?,
    val noShowRate: Double?,
)

data class DashboardTotals(
    val todayTotal: Int?,
    val todayActive: Int?,
    val todayCompleted: Int?,
    val occupancyRate: Double?,
    val revenueMinor: Long?,
    val currency: String,
    val noShowRate: Double?,
)

enum class BranchMetric(
    val label: String,
) {
    Today("Bugün"),
    Occupancy("Doluluk"),
    Revenue("Ciro"),
    NoShow("Gelmeme"),
}

/** Tüm şubelerin sıradaki randevusu, tek listede. */
data class UpcomingItem(
    val entry: CalendarEntry,
    val branchName: String,
    val timezone: String,
)

object DashboardSummaries {
    /**
     * Listelerin önizleme boyu. Kart ekranda SINIRLI yer kaplamalı: 30 randevulu bir günde kart
     * sayfayı ele geçirir ve altındaki grafik hiç görülmezdi. Fazlası "Tümünü gör" ile açılır.
     */
    const val PREVIEW_LIMIT = 5

    private fun occupiesSlot(status: AppointmentStatus) =
        status != AppointmentStatus.Cancelled && status != AppointmentStatus.NoShow

    /** Pasif şubeler dışarıda: kapanmış bir şubenin "bugün 0 randevu" satırı bilgi değil gürültü. */
    fun activeBranches(branches: List<BranchSummary>): List<BranchSummary> = branches.filter { it.isActive }

    fun summarizeDay(
        entries: List<CalendarEntry>,
        now: Instant,
        upcomingLimit: Int = PREVIEW_LIMIT,
    ): DaySummary {
        val active = entries.filter { occupiesSlot(it.status) }
        val pending =
            active
                .filter { it.status != AppointmentStatus.Completed && !it.startsAt.isBefore(now) }
                .sortedBy { it.startsAt }
        return DaySummary(
            total = entries.size,
            active = active.size,
            completed = entries.count { it.status == AppointmentStatus.Completed },
            // Şube başına önizleme kadarı yeter: birleşik listenin ilk N'i her şubenin ilk N'inden.
            upcoming = pending.take(upcomingLimit),
            pending = pending.size,
        )
    }

    /**
     * Rapor geldiyse ama şubenin satırı yoksa o dönemde veri YOK demektir — sıfır. Rapor hiç
     * gelmediyse bilinmiyor — `null`.
     */
    fun merge(
        branches: List<BranchSummary>,
        days: Map<String, Pair<List<CalendarEntry>, String>>,
        occupancy: OccupancyReport?,
        revenue: RevenueReport?,
        noShow: NoShowReport?,
        now: Instant,
    ): List<BranchDashboardSummary> {
        val occupancyRows = occupancy?.data.orEmpty().filter { it.groupId != null }.associateBy { it.groupId }
        val revenueRows = revenue?.data.orEmpty().filter { it.groupId != null }.associateBy { it.groupId }
        val noShowRows = noShow?.data.orEmpty().filter { it.groupId != null }.associateBy { it.groupId }
        return branches.map { branch ->
            val day = days[branch.id]
            BranchDashboardSummary(
                branch = branch,
                today = day?.let { summarizeDay(it.first, now) },
                timezone = day?.second ?: branch.timezone,
                occupancyRate = occupancy?.let { occupancyRows[branch.id]?.occupancyRate ?: 0.0 },
                revenueMinor = revenue?.let { revenueRows[branch.id]?.accruedMinor ?: 0L },
                noShowRate = noShow?.let { noShowRows[branch.id]?.noShowRate ?: 0.0 },
            )
        }
    }

    /**
     * Oranlar şube ortalaması DEĞİL, raporun kendi `totals`ından: 10 randevulu şubeyle 200
     * randevulu şubeyi eşit ağırlıkla ortalamak yanlış bir sayı üretir.
     */
    fun totals(
        summaries: List<BranchDashboardSummary>,
        occupancy: OccupancyReport?,
        revenue: RevenueReport?,
        noShow: NoShowReport?,
    ): DashboardTotals {
        val days = summaries.mapNotNull { it.today }
        fun sum(pick: (DaySummary) -> Int): Int? = if (days.isEmpty()) null else days.sumOf(pick)
        return DashboardTotals(
            todayTotal = sum { it.total },
            todayActive = sum { it.active },
            todayCompleted = sum { it.completed },
            occupancyRate = occupancy?.totals?.occupancyRate,
            revenueMinor = revenue?.totals?.accruedMinor,
            currency = revenue?.totals?.currency ?: "TRY",
            noShowRate = noShow?.totals?.noShowRate,
        )
    }

    /** Tüm şubelerde bugün bekleyen randevu sayısı (önizlemeden bağımsız). */
    fun pendingTotal(summaries: List<BranchDashboardSummary>): Int = summaries.sumOf { it.today?.pending ?: 0 }

    fun upcoming(
        summaries: List<BranchDashboardSummary>,
        limit: Int = PREVIEW_LIMIT,
    ): List<UpcomingItem> =
        summaries
            .flatMap { summary ->
                summary.today?.upcoming.orEmpty().map { UpcomingItem(it, summary.branch.name, summary.timezone) }
            }.sortedBy { it.entry.startsAt }
            .take(limit)

    /**
     * Grafikte seçilebilir göstergeler, sabit sırayla. Rapor göstergesi ya tüm şubelerde bilinir
     * ya hiçbirinde (aynı rapordan); bugün şube şube düşebildiği için "en az bir şubede" yeterli.
     */
    fun availableMetrics(summaries: List<BranchDashboardSummary>): List<BranchMetric> {
        val first = summaries.firstOrNull() ?: return emptyList()
        return buildList {
            if (summaries.any { it.today != null }) add(BranchMetric.Today)
            if (first.occupancyRate != null) add(BranchMetric.Occupancy)
            if (first.revenueMinor != null) add(BranchMetric.Revenue)
            if (first.noShowRate != null) add(BranchMetric.NoShow)
        }
    }

    /** Çubuğun sayısal değeri; bilinmeyen 0 çizilir. */
    fun metricValue(
        summary: BranchDashboardSummary,
        metric: BranchMetric,
    ): Double =
        when (metric) {
            BranchMetric.Today -> summary.today?.total?.toDouble() ?: 0.0
            BranchMetric.Occupancy -> summary.occupancyRate ?: 0.0
            BranchMetric.Revenue -> (summary.revenueMinor ?: 0L).toDouble()
            BranchMetric.NoShow -> summary.noShowRate ?: 0.0
        }

    /**
     * Ciroya, eşitlikte işlem sayısına, o da eşitse ada göre — sıra her yenilemede aynı.
     *
     * Bu ay ne işlemi ne cirosu olan personel DIŞARIDA: çalışma planı olduğu için raporda satırı
     * var ama "₺0,00 · 0 işlem" satırları listeyi bilgi taşımayan kayıtlarla dolduruyor ve ayın
     * başında boş durumu hiç göstermiyordu.
     */
    fun topStaffByRevenue(report: StaffPerformanceReport?): List<StaffPerformanceRow> =
        report
            ?.data
            .orEmpty()
            .filter { it.revenueMinor != 0L || it.completedServices != 0 }
            .sortedWith(
                compareByDescending<StaffPerformanceRow> { it.revenueMinor }
                    .thenByDescending { it.completedServices }
                    .thenBy(Collator.getInstance(TrLocale)) { it.staffName },
            )
}
