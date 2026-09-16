import SwiftUI

/// Ciro — dönemde tamamlanan hizmetlerin ve satılan paketlerin bedeli.
///
/// Tahsilat takibi kapsam dışı: rapor "ne kadar hizmet verildi" sorusunu
/// cevaplar, "kasaya ne girdi" sorusunu değil.
struct RevenueReportView: View {

    let session: AppSession
    let store: ReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.revenue,
            emptyCheck: { $0.data.isEmpty },
            emptyTitle: "Bu dönemde ciro yok",
            emptyMessage: "Seçilen aralıkta tamamlanan hizmet ya da paket satışı yok.",
            emptyIcon: "banknote",
            onRetry: { await store.loadRevenue() }
        ) { report in
            ReportPeriodBar(label: store.periodLabel) { shift in
                store.shiftPeriod(by: shift)
                Task { await store.loadRevenue() }
            }

            KlinaraSegmentedPicker(
                options: RevenueGrouping.allCases,
                selection: Binding(
                    get: { store.revenueGrouping },
                    set: { store.revenueGrouping = $0 }
                ),
                title: { $0.turkishName }
            )
            .onChange(of: store.revenueGrouping) { _, _ in
                Task { await store.loadRevenue() }
            }

            KlinaraCard(title: "Toplam") {
                KlinaraRow(
                    label: "Ciro",
                    value: Money.format(minor: report.totals.accruedMinor, currency: report.totals.currency),
                    detail: ReportFormat.delta(report.delta?["accruedMinor"] ?? nil)
                        ?? "Tamamlanan hizmet ve paket satışları",
                    isMonospaced: true
                )
            }

            KlinaraCard {
                KlinaraChart(
                    kind: store.revenueGrouping == .day ? .line : .bar,
                    points: report.data.map {
                        KlinaraChartPoint(
                            id: $0.id,
                            label: $0.groupLabel,
                            value: Double($0.accruedMinor) / 100
                        )
                    },
                    format: { ReportFormat.number($0) }
                )
            }

            ForEach(report.data) { row in
                KlinaraCard(title: row.groupLabel) {
                    KlinaraRow(
                        label: "Ciro",
                        value: Money.format(minor: row.accruedMinor, currency: report.totals.currency),
                        isMonospaced: true
                    )
                }
            }

            if store.canLoadMoreRevenue {
                loadMoreTrigger
            }
        }
        .navigationTitle("Ciro")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadRevenue() }
    }

    /// Listenin sonuna gelindiğinde sonraki sayfayı ister.
    ///
    /// Sunucu tarafında sayfalama opt-in; mobil istemci onu açıyor ve
    /// `groupBy=day` ile 12 aylık bir rapor artık 365 satırı tek yanıtta
    /// indirmiyor. Toplamlar sayfa eklendikçe DEĞİŞMİYOR — aralığın
    /// tamamından geliyorlar.
    private var loadMoreTrigger: some View {
        HStack {
            Spacer()
            ProgressView()
                .tint(KlinaraColor.sage)
            Spacer()
        }
        .padding(.vertical, KlinaraMetrics.md)
        .onAppear { Task { await store.loadMoreRevenue() } }
    }
}
