import SwiftUI

/// Dönem kullanımı — satılan, tüketilen, iade, süre dolumu, devir, düzeltme.
///
/// Rakamlar **defterden** hesaplanır ve ters kayıtlar toplamdan otomatik
/// düşer: geri alınmış bir tamamlama burada tüketim olarak görünmez.
struct UsageReportView: View {

    let session: AppSession
    let store: PackageReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.usage,
            emptyCheck: { $0.data.isEmpty },
            emptyTitle: "Bu dönemde hareket yok",
            emptyMessage: "Seçilen aralıkta defter satırı oluşmamış.",
            emptyIcon: "chart.bar",
            onRetry: { await store.loadUsage() }
        ) { report in
            ReportPeriodBar(label: store.periodLabel) { shift in
                store.shiftPeriod(by: shift)
                Task { await store.loadUsage() }
            }

            KlinaraSegmentedPicker(
                options: UsageGrouping.allCases,
                selection: Binding(
                    get: { store.usageGrouping },
                    set: { store.usageGrouping = $0 }
                ),
                title: { $0.turkishName }
            )
            .onChange(of: store.usageGrouping) { _, _ in
                Task { await store.loadUsage() }
            }

            ForEach(report.data) { row in
                KlinaraCard(title: row.groupLabel) {
                    KlinaraRow(label: "Satılan", value: "\(row.purchased) seans")
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Tüketilen",
                        value: "\(row.consumed) seans",
                        detail: "Ters kayıtlar düşülmüştür"
                    )
                    KlinaraDivider()
                    KlinaraRow(label: "İade", value: "\(row.refunded) seans")
                    KlinaraDivider()
                    KlinaraRow(label: "Süre dolumu", value: "\(row.expired) seans")
                    KlinaraDivider()
                    KlinaraRow(label: "Devir", value: "\(row.transferred) seans")
                    KlinaraDivider()
                    KlinaraRow(label: "Manuel düzeltme", value: "\(row.adjusted) seans")
                }
            }
        }
        .navigationTitle("Dönem kullanımı")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadUsage() }
        .refreshable { await store.loadUsage() }
    }
}
