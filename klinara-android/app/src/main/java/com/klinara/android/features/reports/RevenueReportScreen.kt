package com.klinara.android.features.reports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraChart
import com.klinara.android.designsystem.components.KlinaraChartPoint
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.features.customers.SelectableChip
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.reports.ReportKind
import com.klinara.android.services.reports.RevenueGrouping
import com.klinara.android.services.reports.RevenueRow

/**
 * Ciro — dönemde tamamlanan hizmetlerin ve satılan paketlerin bedeli. iOS `RevenueReportView`
 * paritesi. Tahsilat takibi kapsam dışı; rapor "ne kadar hizmet verildi" sorusunu cevaplar.
 *
 * Boş durum `hasMovement`'a bakar, satırlara değil: satırlar sayfalı gelebilir.
 * Gruplama çipleri sarılıyor: segment seçicide "Personel" bile kırpılıyordu.
 */
@Composable
fun RevenueReportScreen(
    state: ReportsUiState,
    labels: ReportLabels,
    actions: ReportActions,
    onGroupingChange: (RevenueGrouping) -> Unit,
    modifier: Modifier = Modifier,
) {
    val grouping = state.revenueGrouping
    ReportScaffold(
        title = "Ciro",
        report = state.revenue,
        labels = labels,
        actions = actions,
        isEmpty = { !it.hasMovement },
        empty = ReportEmpty("Bu dönemde ciro yok", "Seçilen aralıkta tamamlanan hizmet ya da paket satışı yok."),
        kind = ReportKind.Revenue,
        export = state.export,
        compareToPrevious = state.compareToPrevious,
        modifier = modifier,
        controls = {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            ) {
                RevenueGrouping.entries.forEach { option ->
                    SelectableChip(
                        label = option.turkishName,
                        isSelected = option == grouping,
                        onClick = { if (option != grouping) onGroupingChange(option) },
                    )
                }
            }
        },
    ) { report ->
        val currency = report.totals.currency
        KlinaraCard(title = "Toplam") {
            KlinaraRow(
                label = "Ciro",
                value = Money.format(report.totals.accruedMinor, currency),
                detail = ReportFormat.deltaLabel(report.delta, "accruedMinor") ?: "Tamamlanan hizmet ve paket satışları",
            )
        }
        if (report.data.isNotEmpty()) {
            KlinaraCard(title = "Kırılım") {
                KlinaraChart(
                    kind = chartKind(isDaily = grouping == RevenueGrouping.Day),
                    points =
                        report.data.map {
                            KlinaraChartPoint(it.id, label(it, grouping, short = true), majorUnits(it.accruedMinor))
                        },
                    format = ReportFormat::number,
                )
            }
        }
        report.data.forEach { row ->
            KlinaraCard(title = label(row, grouping)) {
                KlinaraRow(label = "Ciro", value = Money.format(row.accruedMinor, currency))
            }
        }
        ReportLoadMore(
            canLoadMore = state.canLoadMore(ReportKind.Revenue),
            isLoading = ReportKind.Revenue in state.loadingMore,
            onLoadMore = actions.onLoadMore,
        )
    }
}

/** Gün kırılımında tarih Türkçe yazıma çevrilir. */
private fun label(
    row: RevenueRow,
    grouping: RevenueGrouping,
    short: Boolean = false,
): String =
    when (grouping) {
        RevenueGrouping.Day -> (if (short) ReportFormat::dayShort else ReportFormat::dayTitle)(row.groupLabel)
        else -> row.groupLabel
    }
