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
import com.klinara.android.services.reports.NoShowGrouping
import com.klinara.android.services.reports.ReportKind

/**
 * Gelmeme ve iptal oranı. iOS `NoShowReportView` paritesi.
 *
 * Grain **randevu**, hizmet değil: gelmeyen bir müşteri, randevusunda üç hizmet olduğu için üç
 * gelmeme sayılmaz. Kaynak kırılımı AYRI: online randevunun gelmeme oranı, kapora almadan online
 * randevu açma kararının ölçüsü.
 */
@Composable
fun NoShowReportScreen(
    state: ReportsUiState,
    labels: ReportLabels,
    actions: ReportActions,
    onGroupingChange: (NoShowGrouping) -> Unit,
    modifier: Modifier = Modifier,
) {
    ReportScaffold(
        title = "Gelmeme ve iptal",
        report = state.noShow,
        labels = labels,
        actions = actions,
        isEmpty = { it.totals.total == 0 },
        empty = ReportEmpty("Bu dönemde randevu yok", "Seçilen aralıkta oran hesaplanacak randevu bulunmuyor."),
        kind = ReportKind.NoShow,
        export = state.export,
        compareToPrevious = state.compareToPrevious,
        modifier = modifier,
        controls = {
            KlinaraSegmentedPicker(
                options = NoShowGrouping.entries,
                selected = state.noShowGrouping,
                onSelect = onGroupingChange,
                title = { it.turkishName },
                modifier = Modifier.fillMaxWidth(),
            )
        },
    ) { report ->
        val isDaily = state.noShowGrouping == NoShowGrouping.Day
        KlinaraCard(title = "Toplam") {
            KlinaraRow(
                label = "Gelmeme oranı",
                value = ReportFormat.percent(report.totals.noShowRate),
                detail = ReportFormat.deltaLabel(report.delta, "noShowRate"),
            )
            KlinaraDivider()
            KlinaraRow(
                label = "İptal oranı",
                value = ReportFormat.percent(report.totals.cancellationRate),
                detail = ReportFormat.deltaLabel(report.delta, "cancellationRate"),
            )
            KlinaraDivider()
            KlinaraRow(
                label = "Randevu",
                value = "${report.totals.total}",
                detail = ReportFormat.deltaLabel(report.delta, "total"),
            )
            KlinaraDivider()
            KlinaraRow(label = "Tamamlanan", value = "${report.totals.completed}")
        }
        if (report.byOrigin.isNotEmpty()) {
            KlinaraCard(
                title = "Randevu kaynağı",
                footnote = "Online randevuda kapora alınmıyor; oran bu kararın ölçüsü.",
            ) {
                report.byOrigin.forEachIndexed { index, origin ->
                    if (index > 0) KlinaraDivider()
                    KlinaraRow(
                        label = origin.turkishName,
                        value = ReportFormat.percent(origin.noShowRate),
                        detail = "${origin.noShow} / ${origin.total} randevu gelinmedi",
                    )
                }
            }
        }
        if (report.data.isNotEmpty()) {
            KlinaraCard(title = "Gelmeme oranı") {
                KlinaraChart(
                    kind = chartKind(isDaily),
                    points =
                    report.data.map { KlinaraChartPoint(it.id, chartLabel(it.groupLabel, isDaily), it.noShowRate) },
                    format = ReportFormat::percent,
                )
            }
        }
        report.data.forEach { row ->
            KlinaraCard(title = ReportFormat.groupTitle(row.groupLabel, isDaily)) {
                KlinaraRow(label = "Gelmeme", value = ReportFormat.percent(row.noShowRate))
                KlinaraDivider()
                KlinaraRow(label = "İptal", value = ReportFormat.percent(row.cancellationRate))
                KlinaraDivider()
                KlinaraRow(
                    label = "Randevu",
                    value = "${row.total}",
                    detail = "${row.completed} tamamlandı · ${row.noShow} gelmedi · ${row.cancelled} iptal",
                )
            }
        }
        ReportLoadMore(
            canLoadMore = state.canLoadMore(ReportKind.NoShow),
            isLoading = ReportKind.NoShow in state.loadingMore,
            onLoadMore = actions.onLoadMore,
        )
    }
}
