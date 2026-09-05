import SwiftUI

/// Doluluk oranı — personel/şube/gün kırılımıyla.
///
/// Payda personelin **gerçekten müsait olduğu** dakikalar: vardiya ∩ şube
/// saatleri, eksi mola, tatil ve izinler. Pay `resource_bookings` üzerindeki
/// işgal ve hazırlık/temizlik payını İÇERİR — o dakikalarda personel başka
/// randevu alamıyor.
struct OccupancyReportView: View {

    let session: AppSession
    let store: ReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.occupancy,
            emptyCheck: { $0.data.isEmpty },
            emptyTitle: "Bu dönemde veri yok",
            emptyMessage: "Seçilen aralıkta çalışma planı ya da randevu bulunmuyor.",
            emptyIcon: "chart.bar",
            onRetry: { await store.loadOccupancy() }
        ) { report in
            ReportPeriodBar(label: store.periodLabel) { shift in
                store.shiftPeriod(by: shift)
                Task { await store.loadOccupancy() }
            }

            ReportScopeNotice(scope: report.scope)

            KlinaraSegmentedPicker(
                options: OccupancyGrouping.allCases,
                selection: Binding(
                    get: { store.occupancyGrouping },
                    set: { store.occupancyGrouping = $0 }
                ),
                title: { $0.turkishName }
            )
            .onChange(of: store.occupancyGrouping) { _, _ in
                Task { await store.loadOccupancy() }
            }

            KlinaraCard(
                title: "Toplam",
                footnote: "Mesai dışı randevu varsa oran %100'ü aşabilir."
            ) {
                KlinaraRow(
                    label: "Doluluk",
                    value: ReportFormat.percent(report.totals.occupancyRate),
                    detail: ReportFormat.delta(report.delta?["occupancyRate"] ?? nil)
                )
                KlinaraDivider()
                KlinaraRow(label: "Dolu", value: ReportFormat.minutes(report.totals.bookedMinutes))
                KlinaraDivider()
                KlinaraRow(
                    label: "Müsait",
                    value: ReportFormat.minutes(report.totals.availableMinutes)
                )
            }

            KlinaraCard {
                KlinaraChart(
                    kind: store.occupancyGrouping == .day ? .line : .bar,
                    points: report.data.map {
                        KlinaraChartPoint(id: $0.id, label: $0.groupLabel, value: $0.occupancyRate)
                    },
                    format: ReportFormat.percent
                )
            }

            ForEach(report.data) { row in
                KlinaraCard(title: row.groupLabel) {
                    KlinaraRow(label: "Doluluk", value: ReportFormat.percent(row.occupancyRate))
                    KlinaraDivider()
                    KlinaraRow(label: "Dolu", value: ReportFormat.minutes(row.bookedMinutes))
                    KlinaraDivider()
                    KlinaraRow(label: "Müsait", value: ReportFormat.minutes(row.availableMinutes))
                }
            }
        }
        .navigationTitle("Doluluk")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadOccupancy() }
    }
}

/// Sunucunun daralttığı kapsamı kullanıcıya SÖYLEYEN rozet.
///
/// `scope` SUNUCUDAN geliyor, istemcinin izin listesine bakıp çıkarım
/// yapmasından değil. İki taraf kuralı ayrı yorumlasaydı, sunucu daraltırken
/// uygulama "tüm klinik" diye başlık atan bir rapor gösterebilirdi.
struct ReportScopeNotice: View {

    let scope: ReportScopeKind

    var body: some View {
        if scope == .own {
            Text("Yalnız kendi verileriniz gösteriliyor.")
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, KlinaraMetrics.xs)
        }
    }
}
