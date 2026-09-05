import SwiftUI

/// Gelmeme ve iptal oranı.
///
/// Grain **randevudur**, hizmet değil: gelmeyen bir müşteri, randevusunda üç
/// hizmet olduğu için üç no-show sayılmaz.
struct NoShowReportView: View {

    let session: AppSession
    let store: ReportsStore

    var body: some View {
        KlinaraScreen(
            state: store.noShow,
            emptyCheck: { $0.totals.total == 0 },
            emptyTitle: "Bu dönemde randevu yok",
            emptyMessage: "Seçilen aralıkta oran hesaplanacak randevu bulunmuyor.",
            emptyIcon: "calendar.badge.exclamationmark",
            onRetry: { await store.loadNoShow() }
        ) { report in
            ReportPeriodBar(label: store.periodLabel) { shift in
                store.shiftPeriod(by: shift)
                Task { await store.loadNoShow() }
            }

            KlinaraSegmentedPicker(
                options: NoShowGrouping.allCases,
                selection: Binding(
                    get: { store.noShowGrouping },
                    set: { store.noShowGrouping = $0 }
                ),
                title: { $0.turkishName }
            )
            .onChange(of: store.noShowGrouping) { _, _ in
                Task { await store.loadNoShow() }
            }

            KlinaraCard(title: "Toplam") {
                KlinaraRow(
                    label: "Gelmeme oranı",
                    value: ReportFormat.percent(report.totals.noShowRate),
                    detail: ReportFormat.delta(report.delta?["noShowRate"] ?? nil)
                )
                KlinaraDivider()
                KlinaraRow(
                    label: "İptal oranı",
                    value: ReportFormat.percent(report.totals.cancellationRate)
                )
                KlinaraDivider()
                KlinaraRow(label: "Randevu", value: "\(report.totals.total)")
                KlinaraDivider()
                KlinaraRow(label: "Tamamlanan", value: "\(report.totals.completed)")
            }

            // Kaynak kırılımı AYRI: online randevunun gelmeme oranı, kapora
            // almadan online randevu açma kararının ölçüsü (bölüm 11, soru 8).
            if !report.byOrigin.isEmpty {
                KlinaraCard(
                    title: "Randevu kaynağı",
                    footnote: "Online randevuda kapora alınmıyor; oran bu kararın ölçüsü."
                ) {
                    ForEach(Array(report.byOrigin.enumerated()), id: \.element.id) { index, origin in
                        if index > 0 { KlinaraDivider() }
                        KlinaraRow(
                            label: origin.turkishName,
                            value: ReportFormat.percent(origin.noShowRate),
                            detail: "\(origin.noShow) / \(origin.total) randevu"
                        )
                    }
                }
            }

            KlinaraCard {
                KlinaraChart(
                    kind: store.noShowGrouping == .day ? .line : .bar,
                    points: report.data.map {
                        KlinaraChartPoint(id: $0.id, label: $0.groupLabel, value: $0.noShowRate)
                    },
                    format: ReportFormat.percent
                )
            }

            ForEach(report.data) { row in
                KlinaraCard(title: row.groupLabel) {
                    KlinaraRow(label: "Gelmeme", value: ReportFormat.percent(row.noShowRate))
                    KlinaraDivider()
                    KlinaraRow(label: "İptal", value: ReportFormat.percent(row.cancellationRate))
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Randevu",
                        value: "\(row.total)",
                        detail: "\(row.completed) tamamlandı · \(row.noShow) gelmedi · \(row.cancelled) iptal"
                    )
                }
            }
        }
        .navigationTitle("Gelmeme ve iptal")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadNoShow() }
    }
}
