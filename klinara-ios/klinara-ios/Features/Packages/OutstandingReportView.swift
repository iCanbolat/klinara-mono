import SwiftUI

/// Taşınan yükümlülük: satılmış ama kullanılmamış seansların parasal karşılığı.
///
/// Bu rapor kliniğin **borcu**dur, geliri değil. Tutar satış anındaki
/// tahsisten hesaplanır; güncel katalog fiyatından hesaplansaydı zam yapan bir
/// klinik taşımadığı bir borcu raporlardı.
struct OutstandingReportView: View {

    let session: AppSession
    let store: PackageReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.outstanding,
            emptyCheck: { $0.data.isEmpty },
            emptyTitle: "Açık paket yok",
            emptyMessage: "Kullanılmamış seans hakkı bulunmuyor.",
            emptyIcon: "banknote",
            onRetry: { await store.loadOutstanding() }
        ) { report in
            totalsCard(report.totals)
            groupingPicker
            rowsCard(report.data, currency: report.totals.currency)
        }
        .navigationTitle("Taşınan yükümlülük")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadOutstanding() }
        .refreshable { await store.loadOutstanding() }
    }

    private func totalsCard(_ totals: OutstandingTotals) -> some View {
        KlinaraCard(footnote: "Satılmış ama kullanılmamış seansların karşılığı.") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                Text(Money.format(minor: totals.outstandingMinor, currency: totals.currency))
                    .klinaraText(.displayM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()

                Text("\(totals.packages) paket · \(totals.remainingSessions) seans")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(KlinaraMetrics.md)
        }
    }

    private var groupingPicker: some View {
        KlinaraSegmentedPicker(
            options: OutstandingGrouping.allCases,
            selection: Binding(
                get: { store.outstandingGrouping },
                set: { store.outstandingGrouping = $0 }
            ),
            title: { $0.turkishName }
        )
        .onChange(of: store.outstandingGrouping) { _, _ in
            Task { await store.loadOutstanding() }
        }
    }

    private func rowsCard(_ rows: [OutstandingRow], currency: String) -> some View {
        KlinaraCard(title: store.outstandingGrouping.turkishName) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { KlinaraDivider() }
                KlinaraRow(
                    label: row.groupLabel,
                    value: Money.format(minor: row.outstandingMinor, currency: currency),
                    detail: "\(row.packages) paket · \(row.remainingSessions) seans"
                )
            }
        }
    }
}
