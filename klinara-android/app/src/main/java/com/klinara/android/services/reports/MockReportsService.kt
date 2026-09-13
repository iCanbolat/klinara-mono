package com.klinara.android.services.reports

import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.contracts.RolePermissions
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.PageInfo
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Base64
import kotlin.random.Random

/**
 * Sunucu olmadan rapor ekranlarını sürmek için rapor servisi — veri [MockReportsData]'dan,
 * toplama [MockReportBuilders]'tan.
 *
 * Taklit edilen DAVRANIŞ (iOS mock'u yalnız şekli taklit ediyordu):
 *
 * - **İzin kapıları** sunucudaki `@RequirePermission`'ların aynısı; kapalı rapor 403.
 * - **Kapsam**: `report.revenue:read` yok ama `report.performance:read.own` var → doluluk ve
 *   performans çağıranın kendi personel satırına kilitlenir ve `scope: own` döner. Mock'ta
 *   uygulayıcı rolünün profili Derya'dır (oturum kullanıcısının profili yok).
 * - **Sayfalama** sunucudaki `pageRows`: opt-in, imleç hem çıpa hem sıra numarası taşır,
 *   toplamlar sayfadan etkilenmez.
 * - **Karşılaştırma**: aynı uzunlukta, hemen önceki pencere; önceki 0 → delta `null`.
 */
class MockReportsService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    /** Oturumdaki rolün izinleri — senaryodan beslenir. */
    private val permissions: () -> Collection<String> = { RolePermissions.forRole("manager") },
    private val now: () -> Instant = Instant::now,
) : ReportsService {
    var failing: Boolean = false

    private val data = MockReportsData(now)

    override suspend fun occupancy(
        query: ReportQuery,
        groupBy: OccupancyGrouping,
        page: ReportPage,
    ): OccupancyReport {
        settle()
        requireAny(Permissions.APPOINTMENT_READ_ALL, Permissions.REPORT_PERFORMANCE_READ_OWN)
        val own = ownStaff()
        fun rows(period: ReportPeriod) =
            MockReportBuilders.occupancyRows(
                data.shifts(period, query.branchId, own),
                data.visits(period, query.branchId, own),
                groupBy,
            )
        val rows = rows(query.period)
        val totals = MockReportBuilders.occupancyTotals(rows)
        val previous = query.previous()?.let { MockReportBuilders.occupancyTotals(rows(it)) }
        val sliced = paginate(rows, page) { it.id }
        return OccupancyReport(
            scope = scope(own),
            period = echo(query.period),
            totals = totals,
            data = sliced.first,
            pageInfo = sliced.second,
            previous = previous,
            delta = previous?.let(totals::delta),
        )
    }

    override suspend fun revenue(
        query: ReportQuery,
        groupBy: RevenueGrouping,
        page: ReportPage,
    ): RevenueReport {
        settle()
        requireAny(Permissions.REPORT_REVENUE_READ)
        val visits = data.visits(query.period, query.branchId, staffId = null)
        val totals = MockReportBuilders.revenueTotals(visits)
        val previous =
            query.previous()?.let { MockReportBuilders.revenueTotals(data.visits(it, query.branchId, staffId = null)) }
        val sliced = paginate(MockReportBuilders.revenueRows(visits, groupBy), page) { it.id }
        return RevenueReport(
            scope = ReportScope.All,
            period = echo(query.period),
            totals = totals,
            data = sliced.first,
            pageInfo = sliced.second,
            previous = previous,
            delta = previous?.let(totals::delta),
        )
    }

    override suspend fun staffPerformance(
        query: ReportQuery,
        page: ReportPage,
    ): StaffPerformanceReport {
        settle()
        requireAny(Permissions.REPORT_REVENUE_READ, Permissions.REPORT_PERFORMANCE_READ_OWN)
        val own = ownStaff()
        val rows =
            MockReportBuilders.staffRows(
                data.shifts(query.period, query.branchId, own),
                data.visits(query.period, query.branchId, own),
            )
        val sliced = paginate(rows, page) { it.staffProfileId }
        return StaffPerformanceReport(
            scope = scope(own),
            period = echo(query.period),
            data = sliced.first,
            pageInfo = sliced.second,
        )
    }

    override suspend fun noShow(
        query: ReportQuery,
        groupBy: NoShowGrouping,
        page: ReportPage,
    ): NoShowReport {
        settle()
        requireAny(Permissions.APPOINTMENT_READ_ALL)
        val visits = data.visits(query.period, query.branchId, staffId = null)
        val totals = MockReportBuilders.noShowTotals(visits)
        val previous =
            query.previous()?.let { MockReportBuilders.noShowTotals(data.visits(it, query.branchId, staffId = null)) }
        val sliced = paginate(MockReportBuilders.noShowRows(visits, groupBy), page) { it.id }
        return NoShowReport(
            period = echo(query.period),
            totals = totals,
            data = sliced.first,
            pageInfo = sliced.second,
            byOrigin = MockReportBuilders.byOrigin(visits),
            previous = previous,
            delta = previous?.let(totals::delta),
        )
    }

    override suspend fun retention(query: ReportQuery): RetentionReport {
        settle()
        requireAny(Permissions.APPOINTMENT_READ_ALL)
        val history = data.history(query.branchId)
        val today = data.localDate(now())
        fun compute(period: ReportPeriod) =
            MockReportBuilders.retention(history, data.days(period).toSet(), today, data::source)
        val (totals, acquisition, cohorts) = compute(query.period)
        val previous = query.previous()?.let { compute(it).first }
        return RetentionReport(
            period = echo(query.period),
            totals = totals,
            acquisition = acquisition,
            cohorts = cohorts,
            previous = previous,
            delta = previous?.let(totals::delta),
        )
    }

    /** Sunucu gibi: rapor SAYFASIZ kurulur ve CSV'ye döker. İzin kapısı raporun kendisininki. */
    override suspend fun export(
        kind: ReportKind,
        query: ReportQuery,
        groupBy: String?,
    ): ByteArray {
        val unpaged = query.copy(compareToPrevious = false)
        val csv =
            when (kind) {
                ReportKind.Occupancy -> {
                    val grouping = grouping(OccupancyGrouping.entries, groupBy) { it.wire }
                    MockReportCsv.occupancy(occupancy(unpaged, grouping))
                }
                ReportKind.Revenue ->
                    MockReportCsv.revenue(revenue(unpaged, grouping(RevenueGrouping.entries, groupBy) { it.wire }))
                ReportKind.StaffPerformance -> MockReportCsv.staffPerformance(staffPerformance(unpaged))
                ReportKind.NoShow ->
                    MockReportCsv.noShow(noShow(unpaged, grouping(NoShowGrouping.entries, groupBy) { it.wire }))
                ReportKind.Retention -> MockReportCsv.retention(retention(unpaged))
            }
        return csv.toByteArray(Charsets.UTF_8)
    }

    // --- Yardımcılar ---

    private fun requireAny(vararg required: String) {
        val granted = permissions()
        if (required.none { it in granted }) throw MockErrors.forbidden("Bu rapor için yetkiniz yok.")
    }

    /** Sunucunun `needsOwnScope`'u: ciro izni yok, kendi performans izni var. */
    private fun ownStaff(): String? {
        val granted = permissions()
        val own =
            Permissions.REPORT_REVENUE_READ !in granted && Permissions.REPORT_PERFORMANCE_READ_OWN in granted
        return MockIds.STAFF_DERYA.takeIf { own }
    }

    private fun scope(own: String?): ReportScope = if (own != null) ReportScope.Own else ReportScope.All

    private fun ReportQuery.previous(): ReportPeriod? {
        if (!compareToPrevious) return null
        val span = java.time.Duration.between(period.from, period.to)
        return ReportPeriod(period.from.minus(span), period.from)
    }

    private fun echo(period: ReportPeriod) =
        ReportPeriodEcho(
            from = DateTimeFormatter.ISO_INSTANT.format(period.from),
            to = DateTimeFormatter.ISO_INSTANT.format(period.to),
        )

    private fun <T> grouping(
        entries: List<T>,
        wire: String?,
        wireOf: (T) -> String,
    ): T =
        if (wire == null) {
            entries.first()
        } else {
            entries.firstOrNull { wireOf(it) == wire } ?: throw MockErrors.validation("groupBy", "Geçersiz gruplama.")
        }

    /** Sunucudaki `pageRows`: `limit` ve `cursor` yoksa TÜM satırlar. */
    private fun <T> paginate(
        rows: List<T>,
        page: ReportPage,
        key: (T) -> String,
    ): Pair<List<T>, PageInfo> {
        if (page.limit == null && page.cursor == null) return rows to PageInfo(nextCursor = null, hasMore = false)
        val limit = (page.limit ?: DEFAULT_PAGE).coerceAtMost(MAX_PAGE)
        val start =
            page.cursor?.let { raw ->
                val (ordinal, anchor) = decodeCursor(raw) ?: throw MockErrors.validation("cursor", "Geçersiz imleç.")
                // Çıpa hâlâ listedeyse ondan SONRA; kaybolmuşsa sıra numarasına düşülür.
                rows.indexOfFirst { key(it) == anchor }.takeIf { it >= 0 }?.plus(1) ?: ordinal.coerceAtLeast(0)
            } ?: 0
        val slice = rows.drop(start).take(limit)
        val hasMore = start + slice.size < rows.size
        val next = slice.lastOrNull()?.takeIf { hasMore }?.let { encodeCursor(start + slice.size, key(it)) }
        return slice to PageInfo(nextCursor = next, hasMore = hasMore)
    }

    private fun encodeCursor(
        ordinal: Int,
        anchor: String,
    ): String = Base64.getUrlEncoder().withoutPadding().encodeToString("$ordinal|$anchor".toByteArray())

    private fun decodeCursor(raw: String): Pair<Int, String>? =
        runCatching {
            val text = String(Base64.getUrlDecoder().decode(raw))
            val separator = text.indexOf('|')
            text.substring(0, separator).toInt() to text.substring(separator + 1)
        }.getOrNull()

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 150L
        const val MAX_LATENCY_MILLIS = 450L
        const val DEFAULT_PAGE = 50
        const val MAX_PAGE = 200
    }
}
