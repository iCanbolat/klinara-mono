package com.klinara.android.features.reports

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraChart
import com.klinara.android.designsystem.components.KlinaraChartKind
import com.klinara.android.designsystem.components.KlinaraChartPoint
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.services.reports.ReportKind

/**
 * Müşteri kazanım ve geri dönüş. iOS `RetentionReportView` paritesi.
 *
 * "Yeni müşteri" kayıt tarihine değil İLK TAMAMLANMIŞ randevusuna göre: kayıt açıp hiç gelmeyen
 * biri kazanım sayılsaydı grafik randevu sayfasındaki spam'le birlikte yükselirdi. Yanıt müşteri
 * kimliği taşımıyor; ekranda da hiçbir satır bir müşteriye gitmiyor.
 *
 * Kırılım listesi YOK, sayfalama da yok. Geliş kaynağı kartla aynı Türkçe adla yazılır (iOS ham
 * değeri gösteriyordu: `instagram`).
 */
@Composable
fun RetentionReportScreen(
    state: ReportsUiState,
    labels: ReportLabels,
    actions: ReportActions,
    modifier: Modifier = Modifier,
) {
    ReportScaffold(
        title = "Kazanım ve geri dönüş",
        report = state.retention,
        labels = labels,
        actions = actions,
        isEmpty = { it.totals.activeCustomers == 0 },
        empty =
            ReportEmpty(
                "Bu dönemde müşteri yok",
                "Seçilen aralıkta tamamlanmış randevusu olan müşteri bulunmuyor.",
            ),
        kind = ReportKind.Retention,
        export = state.export,
        compareToPrevious = state.compareToPrevious,
        modifier = modifier,
    ) { report ->
        KlinaraCard(
            title = "Dönem",
            footnote = "Yeni müşteri, kayıt tarihine göre değil ilk tamamlanmış randevusuna göre sayılır.",
        ) {
            KlinaraRow(
                label = "Yeni müşteri",
                value = "${report.totals.newCustomers}",
                detail = ReportFormat.deltaLabel(report.delta, "newCustomers"),
            )
            KlinaraDivider()
            KlinaraRow(
                label = "Geri gelen",
                value = "${report.totals.returningCustomers}",
                detail =
                    ReportFormat.deltaLabel(report.delta, "returningCustomers")
                        ?: "Geri gelme oranı ${ReportFormat.percent(report.totals.returningRate)}",
            )
            KlinaraDivider()
            KlinaraRow(
                label = "Aktif müşteri",
                value = "${report.totals.activeCustomers}",
                detail = ReportFormat.deltaLabel(report.delta, "activeCustomers"),
            )
        }
        if (report.acquisition.isNotEmpty()) {
            if (report.acquisition.size > 1) {
                KlinaraCard(title = "Yeni müşteri — geliş kaynağı") {
                    KlinaraChart(
                        kind = KlinaraChartKind.Bar,
                        points =
                            report.acquisition.map {
                                KlinaraChartPoint(it.id, it.turkishName, it.customers.toDouble())
                            },
                        format = ReportFormat::number,
                        integerValues = true,
                    )
                }
            }
            KlinaraCard(title = "Geliş kaynağı") {
                report.acquisition.forEachIndexed { index, row ->
                    if (index > 0) KlinaraDivider()
                    KlinaraRow(label = row.turkishName, value = "${row.customers} müşteri")
                }
            }
        }
        KlinaraCard(
            title = "Geri dönüş",
            footnote = "Dönem bugüne yakınsa oranlar düşük görünür: müşterilerin 90 günü henüz dolmamış olabilir.",
        ) {
            report.cohorts.forEachIndexed { index, cohort ->
                if (index > 0) KlinaraDivider()
                KlinaraRow(
                    label = "${cohort.withinDays} gün içinde",
                    value = ReportFormat.percent(cohort.rate),
                    detail = "${cohort.returned} yeni müşteri geri geldi",
                )
            }
        }
    }
}
