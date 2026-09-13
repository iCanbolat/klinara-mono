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
import com.klinara.android.services.reports.PaymentMethodLabels
import com.klinara.android.services.reports.ReportKind
import com.klinara.android.services.reports.RevenueGrouping
import com.klinara.android.services.reports.RevenueRow

/**
 * Ciro — tahakkuk eden ve tahsil edilen, AYRI AYRI. iOS `RevenueReportView` paritesi.
 *
 * İkisi aynı sayı değil ve raporun en sık yanlış okunan yeri burası: tahakkuk "bu dönemde ne
 * kadar borç doğdu", tahsilat "bu dönemde kasaya ne girdi".
 *
 * iOS'tan iki bilinçli fark:
 * - **Boş durum `hasMovement`'a bakar**, satırlara değil: eski bir borca bu dönemde yapılan
 *   tahsilat satırsız ama toplamlı bir dönem üretir ve iOS o toplamı gizliyordu.
 * - Yöntem kırılımında ham değer (`card`) yerine Türkçe ad ("Kart") yazılır.
 *
 * Gruplama altı seçenek: segment seçicide "Personel" bile kırpılıyordu; burada çipler sarılıyor.
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
        empty = ReportEmpty("Bu dönemde hareket yok", "Seçilen aralıkta ücret kalemi ya da tahsilat oluşmamış."),
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
                label = "Tahakkuk",
                value = Money.format(report.totals.accruedMinor, currency),
                detail = ReportFormat.deltaLabel(report.delta, "accruedMinor") ?: "Dönemde açılan ücret kalemleri",
            )
            KlinaraDivider()
            KlinaraRow(
                label = "Tahsilat",
                value = Money.format(report.totals.collectedMinor, currency),
                detail =
                    ReportFormat.deltaLabel(report.delta, "collectedMinor")
                        ?: "Dönemde yapılan, iptal edilmemiş tahsilatlar",
            )
            KlinaraDivider()
            KlinaraRow(label = "İade", value = Money.format(report.totals.refundedMinor, currency))
        }
        if (report.data.isNotEmpty()) {
            KlinaraCard(title = "Tahsilat") {
                KlinaraChart(
                    kind = chartKind(isDaily = grouping == RevenueGrouping.Day),
                    points =
                        report.data.map {
                            KlinaraChartPoint(it.id, label(it, grouping, short = true), majorUnits(it.collectedMinor))
                        },
                    format = ReportFormat::number,
                )
            }
        }
        report.data.forEach { row ->
            KlinaraCard(title = label(row, grouping)) {
                if (grouping != RevenueGrouping.Method) {
                    KlinaraRow(label = "Tahakkuk", value = Money.format(row.accruedMinor, currency))
                    KlinaraDivider()
                }
                KlinaraRow(label = "Tahsilat", value = Money.format(row.collectedMinor, currency))
            }
        }
        ReportLoadMore(
            canLoadMore = state.canLoadMore(ReportKind.Revenue),
            isLoading = ReportKind.Revenue in state.loadingMore,
            onLoadMore = actions.onLoadMore,
        )
        // Kırılım toplamının genel toplamdan küçük olabilmesi raporun en sık "hata" sanılan
        // davranışı; not her zaman görünür.
        ReportNote(
            "Kırılım satırlarının tahsilat toplamı genel toplamdan küçük olabilir: eski bir borca bu " +
                "dönemde yapılan tahsilatın bağlanacağı kalem bu dönemde değildir." +
                if (grouping == RevenueGrouping.Method) METHOD_NOTE else "",
        )
    }
}

/** Yöntem kırılımında ham değer (`card`) Türkçe ada, gün kırılımında tarih Türkçe yazıma çevrilir. */
private fun label(
    row: RevenueRow,
    grouping: RevenueGrouping,
    short: Boolean = false,
): String =
    when (grouping) {
        RevenueGrouping.Method -> PaymentMethodLabels.label(row.groupLabel)
        RevenueGrouping.Day -> (if (short) ReportFormat::dayShort else ReportFormat::dayTitle)(row.groupLabel)
        else -> row.groupLabel
    }

private const val METHOD_NOTE = " Ödeme yöntemi bir tahsilat özelliğidir; tahakkuk bu kırılımda yoktur."
