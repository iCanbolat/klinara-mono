import SwiftUI

/// Müşteri kazanım ve geri dönüş.
///
/// "Yeni müşteri" kayıt tarihine değil, **ilk tamamlanmış randevusuna** göre
/// sayılıyor: kayıt açıp hiç gelmeyen biri kazanım sayılsaydı, kazanım grafiği
/// randevu sayfasındaki spam'le birlikte yükselirdi.
struct RetentionReportView: View {

    let session: AppSession
    let store: ReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.retention,
            emptyCheck: { $0.totals.activeCustomers == 0 },
            emptyTitle: "Bu dönemde müşteri yok",
            emptyMessage: "Seçilen aralıkta tamamlanmış randevusu olan müşteri bulunmuyor.",
            emptyIcon: "person.crop.circle.badge.plus",
            onRetry: { await store.loadRetention() }
        ) { report in
            ReportPeriodBar(label: store.periodLabel) { shift in
                store.shiftPeriod(by: shift)
                Task { await store.loadRetention() }
            }

            KlinaraCard(
                title: "Dönem",
                footnote: "Yeni müşteri, kayıt tarihine göre değil ilk tamamlanmış randevusuna göre sayılır."
            ) {
                KlinaraRow(
                    label: "Yeni müşteri",
                    value: "\(report.totals.newCustomers)",
                    detail: ReportFormat.delta(report.delta?["newCustomers"] ?? nil)
                )
                KlinaraDivider()
                KlinaraRow(
                    label: "Geri gelen",
                    value: "\(report.totals.returningCustomers)",
                    detail: ReportFormat.percent(report.totals.returningRate)
                )
                KlinaraDivider()
                KlinaraRow(label: "Aktif müşteri", value: "\(report.totals.activeCustomers)")
            }

            KlinaraCard {
                KlinaraChart(
                    kind: .bar,
                    points: report.acquisition.map {
                        KlinaraChartPoint(id: $0.id, label: $0.turkishName, value: Double($0.customers))
                    },
                    format: { ReportFormat.number($0) }
                )
            }

            KlinaraCard(title: "Geliş kaynağı") {
                ForEach(Array(report.acquisition.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { KlinaraDivider() }
                    KlinaraRow(label: row.turkishName, value: "\(row.customers)")
                }
            }

            KlinaraCard(
                title: "Geri dönüş",
                footnote: "Dönem bugüne yakınsa oranlar düşük görünür: müşterilerin 90 günü henüz dolmamış olabilir."
            ) {
                ForEach(Array(report.cohorts.enumerated()), id: \.element.id) { index, cohort in
                    if index > 0 { KlinaraDivider() }
                    KlinaraRow(
                        label: "\(cohort.withinDays) gün içinde",
                        value: ReportFormat.percent(cohort.rate),
                        detail: "\(cohort.returned) müşteri"
                    )
                }
            }
        }
        .navigationTitle("Kazanım ve geri dönüş")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadRetention() }
    }
}
