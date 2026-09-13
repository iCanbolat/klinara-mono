package com.klinara.android.features.reports

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraChart
import com.klinara.android.designsystem.components.KlinaraChartPoint
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.reports.OccupancyGrouping
import com.klinara.android.services.reports.ReportKind

/**
 * Doluluk oranı — personel/şube/gün kırılımıyla. iOS `OccupancyReportView` paritesi.
 *
 * Payda personelin GERÇEKTEN müsait olduğu dakikalar (vardiya ∩ şube saatleri, eksi mola, tatil,
 * izin); pay hazırlık/temizlik payını İÇERİR — o dakikalarda personel başka randevu alamıyor.
 */
@Composable
fun OccupancyReportScreen(
    state: ReportsUiState,
    labels: ReportLabels,
    actions: ReportActions,
    onGroupingChange: (OccupancyGrouping) -> Unit,
    modifier: Modifier = Modifier,
) {
    ReportScaffold(
        title = "Doluluk",
        report = state.occupancy,
        labels = labels,
        actions = actions,
        isEmpty = { it.data.isEmpty() },
        empty = ReportEmpty("Bu dönemde veri yok", "Seçilen aralıkta çalışma planı ya da randevu bulunmuyor."),
        kind = ReportKind.Occupancy,
        export = state.export,
        compareToPrevious = state.compareToPrevious,
        modifier = modifier,
        controls = {
            KlinaraSegmentedPicker(
                options = OccupancyGrouping.entries,
                selected = state.occupancyGrouping,
                onSelect = onGroupingChange,
                title = { it.turkishName },
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) { report ->
        val isDaily = state.occupancyGrouping == OccupancyGrouping.Day
        ReportScopeNotice(report.scope)
        KlinaraCard(title = "Toplam", footnote = "Mesai dışı randevu varsa oran %100'ü aşabilir.") {
            KlinaraRow(
                label = "Doluluk",
                value = ReportFormat.percent(report.totals.occupancyRate),
                detail = ReportFormat.deltaLabel(report.delta, "occupancyRate"),
            )
            KlinaraDivider()
            KlinaraRow(
                label = "Dolu",
                value = DurationFormat.format(report.totals.bookedMinutes),
                detail = ReportFormat.deltaLabel(report.delta, "bookedMinutes"),
            )
            KlinaraDivider()
            KlinaraRow(label = "Müsait", value = DurationFormat.format(report.totals.availableMinutes))
        }
        KlinaraCard(title = "Doluluk oranı") {
            KlinaraChart(
                kind = chartKind(isDaily),
                points =
                    report.data.map { KlinaraChartPoint(it.id, chartLabel(it.groupLabel, isDaily), it.occupancyRate) },
                format = ReportFormat::percent,
            )
        }
        report.data.forEach { row ->
            KlinaraCard(title = ReportFormat.groupTitle(row.groupLabel, isDaily)) {
                KlinaraRow(label = "Doluluk", value = ReportFormat.percent(row.occupancyRate))
                KlinaraDivider()
                KlinaraRow(label = "Dolu", value = DurationFormat.format(row.bookedMinutes))
                KlinaraDivider()
                KlinaraRow(label = "Müsait", value = DurationFormat.format(row.availableMinutes))
            }
        }
        ReportLoadMore(
            canLoadMore = state.canLoadMore(ReportKind.Occupancy),
            isLoading = ReportKind.Occupancy in state.loadingMore,
            onLoadMore = actions.onLoadMore,
        )
    }
}
