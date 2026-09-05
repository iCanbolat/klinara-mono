import SwiftUI

/// Personel performansı — işlem sayısı, ciro, prim ve doluluk.
///
/// Ciro `charges` üzerinden okunuyor, kalem fiyatından değil: indirim, fiyat
/// override'ı ve KDV yalnız orada yaşıyor ve kalem fiyatını toplamak, ciro
/// raporuyla çelişen bir sayı üretirdi.
struct StaffPerformanceReportView: View {

    let session: AppSession
    let store: ReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.staffPerformance,
            emptyCheck: { $0.data.isEmpty },
            emptyTitle: "Bu dönemde veri yok",
            emptyMessage: "Seçilen aralıkta tamamlanmış işlem ya da çalışma planı bulunmuyor.",
            emptyIcon: "person.2",
            onRetry: { await store.loadStaffPerformance() }
        ) { report in
            ReportPeriodBar(label: store.periodLabel) { shift in
                store.shiftPeriod(by: shift)
                Task { await store.loadStaffPerformance() }
            }

            ReportScopeNotice(scope: report.scope)

            KlinaraCard {
                KlinaraChart(
                    kind: .bar,
                    points: report.data.map {
                        KlinaraChartPoint(
                            id: $0.id,
                            label: $0.staffName,
                            value: Double($0.revenueMinor) / 100
                        )
                    },
                    format: { ReportFormat.number($0) }
                )
            }

            ForEach(report.data) { row in
                KlinaraCard(title: row.staffName) {
                    KlinaraRow(label: "Tamamlanan işlem", value: "\(row.completedServices)")
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Ciro",
                        value: Money.format(minor: row.revenueMinor, currency: report.currency),
                        isMonospaced: true
                    )
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Prim",
                        value: Money.format(minor: row.commissionMinor, currency: report.currency),
                        detail: "Ters kayıtlar düşülmüştür",
                        isMonospaced: true
                    )
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Doluluk",
                        value: ReportFormat.percent(row.occupancyRate),
                        detail: "\(ReportFormat.minutes(row.bookedMinutes)) / \(ReportFormat.minutes(row.availableMinutes))"
                    )
                }
            }
        }
        .navigationTitle("Personel performansı")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadStaffPerformance() }
    }
}
