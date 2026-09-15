package com.klinara.android.features.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraStat
import com.klinara.android.designsystem.components.KlinaraStatStrip
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.reports.ReportFormat
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.formatting.TrLocale
import com.klinara.android.services.reports.ReportScope
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * Dashboard — web `/dashboard` paritesi ve uygulamanın AÇILIŞ sekmesi.
 *
 * Sıra web ile aynı, "önce şimdi, sonra karşılaştırma": özet kart şeridi, sıradaki randevular,
 * personel cirosu, en altta şube grafiği.
 *
 * Şube grafiği yatay çubuk; aynı anda TEK gösterge (birimler farklı: adet, yüzde, para). Çubuk
 * satırları Compose `Row` — `KlinaraChart` dikey sütun çiziyor ve uzun şube adlarını kırpıyor;
 * burada ad çubuğun üstünde tam yazılıyor ve her satır TalkBack'e "Şube, değer" diye okunuyor,
 * yani grafik ile erişilebilir liste aynı şey.
 */
@Composable
fun DashboardHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    /** Takvim sekmesine geçer; "Sıradaki randevular → Tümünü gör". */
    onOpenCalendar: () -> Unit,
    /** Personel performansı raporunu açar; "Personel cirosu → Tümünü gör". */
    onOpenStaffReport: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val access = remember(session.profile.permissions) { DashboardAccess.of(session::can) }
    val viewModel: DashboardViewModel =
        viewModel(
            viewModelStoreOwner = owner,
            key = "dashboard-${session.branches.joinToString { it.id }}-${access.hashCode()}",
            factory = DashboardViewModel.factory(container, session.branches, access),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val subtitle =
        remember(session.activeBranch?.timezone) {
            val clock = BranchClock(session.activeBranch?.timezone)
            TODAY_LABEL.format(clock.localDate(Instant.now()))
        }

    DashboardScreen(
        state = state,
        access = access,
        greeting = "Merhaba, ${session.profile.user.fullName}",
        subtitle = subtitle,
        actions = DashboardActions(viewModel::reload, onOpenCalendar, onOpenStaffReport),
        modifier = modifier,
        trailing = trailing,
    )
}

data class DashboardActions(
    val onReload: () -> Unit,
    val onOpenCalendar: () -> Unit,
    val onOpenStaffReport: () -> Unit,
)

private val TODAY_LABEL: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM EEEE", TrLocale)

@Composable
fun DashboardScreen(
    state: DashboardUiState,
    access: DashboardAccess,
    greeting: String,
    subtitle: String,
    actions: DashboardActions,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    KlinaraScreen(title = "Dashboard", modifier = modifier, trailing = trailing) {
        Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            Text(greeting, style = KlinaraType.displayM, color = KlinaraTheme.colors.charcoal)
            Text(subtitle, style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        }
        if (access.isEmpty) {
            EmptyStateView(
                title = "Özet erişiminiz yok",
                message = "Rolünüz randevu ya da rapor görüntülemeyi kapsamıyor.",
                icon = Icons.Filled.Home,
            )
            return@KlinaraScreen
        }

        val data = state.data
        // İlk yüklemede şerit yer tutucularla duruyor: içerik geldiğinde sayfa aşağı zıplamasın.
        KlinaraStatStrip(stats = dashboardStats(data, access), isLoading = data == null)
        if (data == null) return@KlinaraScreen

        KlinaraButton(
            title = "Yenile",
            onClick = actions.onReload,
            kind = KlinaraButtonKind.Secondary,
            isLoading = state.isLoading,
            modifier = Modifier.fillMaxWidth(),
        )

        val warning =
            listOfNotNull(
                data.calendarError?.let { "Bazı şubelerin bugünkü takvimi alınamadı." },
                data.reportsError?.let { "Aylık özetler alınamadı." },
            ).joinToString(" ")
        if (warning.isNotEmpty()) ErrorBanner(message = warning, onRetry = actions.onReload)

        if (access.calendar) UpcomingCard(data, actions.onOpenCalendar)
        if (access.staff) StaffRevenueCard(data, actions.onOpenStaffReport)
        BranchChartCard(data)
    }
}

/**
 * Özet kartları — web KPI şeridiyle aynı dört kart, aynı izinlerle. Kaynağı düşen kartın değeri
 * `null` ("—"): kart yerinde kalır ki şerit düzeni hatadan hatalara değişmesin.
 */
internal fun dashboardStats(
    data: DashboardData?,
    access: DashboardAccess,
): List<KlinaraStat> {
    val totals = data?.totals
    return buildList {
        if (access.calendar) {
            add(
                KlinaraStat(
                    label = "Bugünkü randevu",
                    value = totals?.todayTotal?.toString(),
                    icon = Icons.Filled.DateRange,
                    hint = totals?.let(::todayDetail),
                ),
            )
        }
        if (access.occupancy) {
            add(
                KlinaraStat(
                    label = "Bu ay doluluk",
                    value = totals?.occupancyRate?.let(ReportFormat::percent),
                    icon = Icons.Filled.CheckCircle,
                    hint = deltaDetail(data?.occupancyDelta),
                ),
            )
        }
        if (access.revenue) {
            add(
                KlinaraStat(
                    label = "Bu ay ciro",
                    value = totals?.revenueMinor?.let { Money.format(it, totals.currency) },
                    icon = Icons.Filled.ShoppingCart,
                    hint = deltaDetail(data?.revenueDelta),
                ),
            )
        }
        if (access.occupancy) {
            add(
                KlinaraStat(
                    label = "Bu ay gelmeme",
                    value = totals?.noShowRate?.let(ReportFormat::percent),
                    icon = Icons.Filled.Warning,
                    hint = deltaDetail(data?.noShowDelta),
                ),
            )
        }
    }
}

private fun todayDetail(totals: DashboardTotals): String? {
    val active = totals.todayActive ?: return null
    val completed = totals.todayCompleted ?: return null
    return "$active aktif · $completed tamamlandı"
}

private fun deltaDetail(value: Double?): String? = ReportFormat.delta(value)?.let { "Geçen aya göre $it" }

/**
 * Bugün bekleyen randevular — önizleme [DashboardSummaries.PREVIEW_LIMIT] kadar.
 *
 * Kart SINIRLI: her satır tek yükseklikte (ad ve hizmet tek satıra kırpılır) ve en fazla beş satır.
 * Başlık toplamı söyler; fazlası varsa son satır takvime götürür. Liste kaydırılabilir bir iç alan
 * DEĞİL — sayfa zaten kayıyor ve iç içe kaydırma parmağın altında hangi listenin kaydığını belirsiz
 * kılar.
 */
@Composable
private fun UpcomingCard(
    data: DashboardData,
    onOpenCalendar: () -> Unit,
) {
    val upcoming = remember(data.summaries) { DashboardSummaries.upcoming(data.summaries) }
    val total = remember(data.summaries) { DashboardSummaries.pendingTotal(data.summaries) }
    val multiBranch = data.summaries.size > 1
    KlinaraCard(title = listTitle("Sıradaki randevular", total)) {
        if (upcoming.isEmpty()) {
            EmptyLine("Bugün için bekleyen randevu yok.")
        }
        upcoming.forEachIndexed { index, item ->
            if (index > 0) KlinaraDivider()
            UpcomingRow(item, multiBranch)
        }
        if (total > upcoming.size) {
            KlinaraDivider()
            KlinaraNavigationRow(
                label = "Tümünü takvimde gör",
                value = "+${total - upcoming.size} randevu",
                onClick = onOpenCalendar,
            )
        }
    }
}

@Composable
private fun UpcomingRow(
    item: UpcomingItem,
    multiBranch: Boolean,
) {
    val colors = KlinaraTheme.colors
    val detail =
        listOf(item.entry.serviceSummary, if (multiBranch) item.branchName else "")
            .filter { it.isNotBlank() }
            .joinToString(" · ")
    val time = BranchClock(item.timezone).formatTime(item.entry.startsAt)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = KlinaraMetrics.xs)
                .semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Text(time, style = KlinaraType.bodyEmphasis, color = colors.charcoal, modifier = Modifier.width(TIME_WIDTH))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                item.entry.customerName,
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            // Hizmet yoksa da satır yüksekliği sabit kalsın diye boş satır yer tutar.
            Text(
                detail,
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
                minLines = 1,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        KlinaraBadge(text = item.entry.status.turkishName, tone = item.entry.status.badgeTone)
    }
}

/**
 * Bu ayın personel cirosu — en çoktan aza, önizleme [DashboardSummaries.PREVIEW_LIMIT] kadar.
 * Çubuk listenin en yükseğine göre ölçekli: sıralamayı göz ucuyla okutmak için, mutlak bir hedefi
 * temsil etmiyor. Fazlası personel performansı raporunda.
 */
@Composable
private fun StaffRevenueCard(
    data: DashboardData,
    onOpenReport: () -> Unit,
) {
    val report = data.staffPerformance
    val all = remember(report) { DashboardSummaries.topStaffByRevenue(report) }
    val rows = all.take(DashboardSummaries.PREVIEW_LIMIT)
    val peak = rows.firstOrNull()?.revenueMinor ?: 0L
    val currency = report?.currency ?: "TRY"
    KlinaraCard(
        title = listTitle("Personel cirosu · Bu ay", all.size),
        footnote = if (report?.scope == ReportScope.Own) "Yalnız kendi performansınızı görüyorsunuz." else null,
    ) {
        if (rows.isEmpty()) {
            EmptyLine("Bu ay henüz tamamlanan işlem ya da ciro yok.")
        }
        rows.forEachIndexed { index, row ->
            if (index > 0) KlinaraDivider()
            BarRow(
                label = row.staffName,
                value = Money.format(row.revenueMinor, currency),
                detail = "${row.completedServices} işlem",
                segments = listOf(fraction(row.revenueMinor.toDouble(), peak.toDouble()) to BarColor.Primary),
                modifier = Modifier.padding(vertical = KlinaraMetrics.xs),
            )
        }
        if (all.size > rows.size) {
            KlinaraDivider()
            KlinaraNavigationRow(
                label = "Tümünü gör",
                value = "+${all.size - rows.size} personel",
                onClick = onOpenReport,
            )
        }
    }
}

/** Başlıkta toplam: kırpılmış bir listenin kaç kayıttan kırpıldığı görünür olmalı. */
private fun listTitle(
    title: String,
    count: Int,
): String = if (count > 0) "$title · $count" else title

/** Boş durum tek satır: kartın boş hâli dolu hâlinden çok daha kısa kalıp düzeni sarsmasın. */
@Composable
private fun EmptyLine(text: String) {
    Text(
        text,
        style = KlinaraType.bodyM,
        color = KlinaraTheme.colors.charcoalMuted,
        modifier = Modifier.padding(vertical = KlinaraMetrics.sm),
    )
}

@Composable
private fun BranchChartCard(data: DashboardData) {
    val metrics = remember(data.summaries) { DashboardSummaries.availableMetrics(data.summaries) }
    var picked by rememberSaveable { mutableStateOf<BranchMetric?>(null) }
    val metric = picked?.takeIf { it in metrics } ?: metrics.firstOrNull()

    if (data.summaries.isEmpty()) {
        KlinaraCard(title = "Şubeler") {
            EmptyStateView(title = "Şube bulunamadı", message = "Erişebildiğiniz aktif bir şube yok.")
        }
        return
    }
    metric ?: return

    val peak = data.summaries.maxOf { DashboardSummaries.metricValue(it, metric) }
    KlinaraCard(
        title = "Şubeler · ${if (metric == BranchMetric.Today) "Bugün" else "Bu ay"}",
        footnote = "${data.summaries.size} şube",
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md)) {
            if (metrics.size > 1) {
                KlinaraSegmentedPicker(
                    options = metrics,
                    selected = metric,
                    onSelect = { picked = it },
                    title = { it.label },
                )
            }
            if (metric == BranchMetric.Today) TodayLegend()
            data.summaries.forEach { summary ->
                val value = DashboardSummaries.metricValue(summary, metric)
                BarRow(
                    label = summary.branch.name,
                    value = format(metric, value, data.totals.currency),
                    segments =
                        if (metric == BranchMetric.Today) {
                            todaySegments(summary.today, peak)
                        } else {
                            listOf(fraction(value, peak) to BarColor.Primary)
                        },
                )
            }
        }
    }
}

/** Bugün çubuğu üç parça: tamamlanan, bekleyen, iptal/gelmedi — web yığın çubuğunun aynısı. */
private fun todaySegments(
    today: DaySummary?,
    peak: Double,
): List<Pair<Float, BarColor>> {
    today ?: return emptyList()
    return listOf(
        fraction(today.completed.toDouble(), peak) to BarColor.Primary,
        fraction((today.active - today.completed).toDouble(), peak) to BarColor.Secondary,
        fraction((today.total - today.active).toDouble(), peak) to BarColor.Muted,
    )
}

private fun fraction(
    value: Double,
    peak: Double,
): Float = if (peak <= 0.0) 0f else (value / peak).toFloat().coerceIn(0f, 1f)

private fun format(
    metric: BranchMetric,
    value: Double,
    currency: String,
): String =
    when (metric) {
        BranchMetric.Today -> value.toInt().toString()
        BranchMetric.Occupancy, BranchMetric.NoShow -> ReportFormat.percent(value)
        BranchMetric.Revenue -> Money.format(value.toLong(), currency)
    }

private enum class BarColor { Primary, Secondary, Muted }

@Composable
private fun BarColor.color(): Color =
    when (this) {
        BarColor.Primary -> KlinaraTheme.colors.sageDeep
        BarColor.Secondary -> KlinaraTheme.colors.sage
        BarColor.Muted -> KlinaraTheme.colors.charcoalMuted.copy(alpha = 0.45f)
    }

@Composable
private fun TodayLegend() {
    Row(
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
        modifier = Modifier.clearAndSetSemantics { },
    ) {
        listOf("Tamamlanan" to BarColor.Primary, "Bekleyen" to BarColor.Secondary, "İptal / gelmedi" to BarColor.Muted)
            .forEach { (label, color) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(color.color()))
                    Text(
                        label,
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                        modifier = Modifier.padding(start = KlinaraMetrics.xs),
                    )
                }
            }
    }
}

/** Ad + değer üstte, çubuk altta. Parçalar yan yana, toplam genişlik ≤ 1. */
@Composable
private fun BarRow(
    label: String,
    value: String,
    segments: List<Pair<Float, BarColor>>,
    detail: String? = null,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = listOfNotNull(label, value, detail).joinToString(", ")
                },
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            // Tutar KIRPILMAZ ve sarılmaz: ad kırpılır, para eksik okunmamalı.
            Text(
                value,
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.padding(start = KlinaraMetrics.sm),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .height(BAR_HEIGHT)
                        .clip(RoundedCornerShape(BAR_HEIGHT / 2))
                        .background(colors.border.copy(alpha = 0.5f)),
            ) {
                val filled = segments.sumOf { it.first.toDouble() }.toFloat().coerceIn(0f, 1f)
                segments.filter { it.first > 0f }.forEach { (width, color) ->
                    Box(Modifier.fillMaxHeight().weight(width).background(color.color()))
                }
                if (filled < 1f) Box(Modifier.fillMaxHeight().weight(1f - filled))
            }
            if (detail != null) {
                Text(
                    detail,
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                    modifier = Modifier.padding(start = KlinaraMetrics.sm).width(DETAIL_WIDTH),
                    maxLines = 1,
                )
            }
        }
    }
}

private val BAR_HEIGHT = 10.dp
private val DETAIL_WIDTH = 72.dp
private val TIME_WIDTH = 48.dp
