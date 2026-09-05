import SwiftUI

/// Ciro — tahakkuk eden ve tahsil edilen, AYRI AYRI.
///
/// İkisi aynı sayı değil ve raporun en sık yanlış okunan yeri burası:
/// tahakkuk "bu dönemde ne kadar borç doğdu", tahsilat "bu dönemde kasaya ne
/// girdi". Eylülde açılan bir kalem ekimde tahsil edilir.
struct RevenueReportView: View {

    let session: AppSession
    let store: ReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.revenue,
            emptyCheck: { $0.data.isEmpty },
            emptyTitle: "Bu dönemde hareket yok",
            emptyMessage: "Seçilen aralıkta ücret kalemi ya da tahsilat oluşmamış.",
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
                    label: "Tahakkuk",
                    value: Money.format(minor: report.totals.accruedMinor, currency: report.totals.currency),
                    detail: "Dönemde açılan ücret kalemleri",
                    isMonospaced: true
                )
                KlinaraDivider()
                KlinaraRow(
                    label: "Tahsilat",
                    value: Money.format(minor: report.totals.collectedMinor, currency: report.totals.currency),
                    detail: ReportFormat.delta(report.delta?["collectedMinor"] ?? nil)
                        ?? "Dönemde yapılan, iptal edilmemiş tahsilatlar",
                    isMonospaced: true
                )
                KlinaraDivider()
                KlinaraRow(
                    label: "İade",
                    value: Money.format(minor: report.totals.refundedMinor, currency: report.totals.currency),
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
                            value: Double($0.collectedMinor) / 100
                        )
                    },
                    format: { ReportFormat.number($0) }
                )
            }

            ForEach(report.data) { row in
                KlinaraCard(title: row.groupLabel) {
                    KlinaraRow(
                        label: "Tahakkuk",
                        value: Money.format(minor: row.accruedMinor, currency: report.totals.currency),
                        isMonospaced: true
                    )
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Tahsilat",
                        value: Money.format(minor: row.collectedMinor, currency: report.totals.currency),
                        isMonospaced: true
                    )
                }
            }

            // Kırılım toplamının genel toplamdan küçük olabilmesi raporun en
            // sık "hata" sanılan davranışı; not her zaman görünür.
            Text(
                "Kırılım satırlarının tahsilat toplamı genel toplamdan küçük olabilir: "
                    + "eski bir borca bu dönemde yapılan tahsilatın bağlanacağı kalem bu dönemde değildir."
            )
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, KlinaraMetrics.xs)
        }
        .navigationTitle("Ciro")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadRevenue() }
    }
}
