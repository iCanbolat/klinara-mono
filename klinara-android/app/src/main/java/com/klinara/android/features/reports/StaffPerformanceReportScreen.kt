package com.klinara.android.features.reports

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraChart
import com.klinara.android.designsystem.components.KlinaraChartKind
import com.klinara.android.designsystem.components.KlinaraChartPoint
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.reports.ReportKind

/**
 * Personel performansı — işlem, ciro, prim, doluluk. iOS `StaffPerformanceReportView` paritesi.
 *
 * Ciro `charges` üzerinden (indirim, override, KDV orada), kalem fiyatından değil. Karşılaştırma
 * anahtarı YOK: sunucu bu raporda `compareTo`'yu yok sayıyor ve anahtar hiçbir şey değiştirmezdi.
 */
@Composable
fun StaffPerformanceReportScreen(
    state: ReportsUiState,
    labels: ReportLabels,
    actions: ReportActions,
    modifier: Modifier = Modifier,
) {
    ReportScaffold(
        title = "Personel performansı",
        report = state.staffPerformance,
        labels = labels,
        actions = actions,
        isEmpty = { it.data.isEmpty() },
        empty =
            ReportEmpty(
                "Bu dönemde veri yok",
                "Seçilen aralıkta tamamlanmış işlem ya da çalışma planı bulunmuyor.",
            ),
        kind = ReportKind.StaffPerformance,
        export = state.export,
        compareToPrevious = null,
        modifier = modifier,
    ) { report ->
        ReportScopeNotice(report.scope)
        if (report.data.size > 1) {
            KlinaraCard(title = "Ciro") {
                KlinaraChart(
                    kind = KlinaraChartKind.Bar,
                    points =
                        report.data.map {
                            KlinaraChartPoint(it.staffProfileId, it.staffName, majorUnits(it.revenueMinor))
                        },
                    format = ReportFormat::number,
                )
            }
        }
        report.data.forEach { row ->
            KlinaraCard(title = row.staffName) {
                KlinaraRow(label = "Tamamlanan işlem", value = "${row.completedServices}")
                KlinaraDivider()
                KlinaraRow(label = "Ciro", value = Money.format(row.revenueMinor, report.currency))
                KlinaraDivider()
                KlinaraRow(
                    label = "Prim",
                    value = Money.format(row.commissionMinor, report.currency),
                    detail = "Ters kayıtlar düşülmüştür",
                )
                KlinaraDivider()
                KlinaraRow(
                    label = "Doluluk",
                    value = ReportFormat.percent(row.occupancyRate),
                    detail =
                        DurationFormat.format(row.bookedMinutes) + " / " + DurationFormat.format(row.availableMinutes),
                )
            }
        }
        ReportLoadMore(
            canLoadMore = state.canLoadMore(ReportKind.StaffPerformance),
            isLoading = ReportKind.StaffPerformance in state.loadingMore,
            onLoadMore = actions.onLoadMore,
        )
    }
}
