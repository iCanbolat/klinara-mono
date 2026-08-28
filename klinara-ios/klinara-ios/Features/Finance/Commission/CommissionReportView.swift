import SwiftUI

/// Personel bazlı prim özeti.
///
/// Satırlardaki tutarlar **ters kayıtlar düşülmüş** nettir; iptal edilmiş bir
/// tahsilatın primi burada görünmez. Bunu ekranda söylemek gerekiyor: brüt
/// beklerken net gören personel, kliniğe eksik ödeme yapıldığını düşünür.
struct CommissionReportView: View {

    let session: AppSession
    let store: CommissionStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                periodFilter

                switch store.reportState {
                case .loading:
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)

                case .failed(let error):
                    ErrorBanner(error: error, onRetry: { Task { await store.loadReport() } })

                case .loaded(let report):
                    reportCard(report)
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Prim raporu")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await store.loadPeriods()
            await store.loadReport()
        }
    }

    private var periodFilter: some View {
        KlinaraCard(title: "Dönem") {
            Button {
                Task { await store.applyFilter(periodId: nil) }
            } label: {
                KlinaraRow(label: "Tüm dönemler") {
                    Image(systemName: store.selectedPeriodId == nil ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 18))
                        .foregroundStyle(
                            store.selectedPeriodId == nil ? KlinaraColor.sageDeep : KlinaraColor.border
                        )
                }
            }
            .buttonStyle(.plain)

            ForEach(store.periods) { period in
                KlinaraDivider()
                Button {
                    Task { await store.applyFilter(periodId: period.id) }
                } label: {
                    KlinaraRow(label: period.rangeLabel, detail: period.status.turkishName) {
                        Image(systemName: store.selectedPeriodId == period.id ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(
                                store.selectedPeriodId == period.id
                                    ? KlinaraColor.sageDeep
                                    : KlinaraColor.border
                            )
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func reportCard(_ report: CommissionReport) -> some View {
        KlinaraCard(
            title: "Personel primi",
            footnote: "Tutarlar ters kayıtlar DÜŞÜLMÜŞ nettir; iptal edilen tahsilatların primi görünmez."
        ) {
            if report.rows.isEmpty {
                KlinaraRow(label: "Bu dönemde prim tahakkuku yok")
            } else {
                ForEach(Array(report.rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { KlinaraDivider() }
                    KlinaraRow(
                        label: row.staffName,
                        value: Money.format(minor: row.amountMinor, currency: report.currency),
                        detail: "\(row.accrualCount) tahakkuk",
                        isMonospaced: true
                    )
                }
                KlinaraDivider()
                KlinaraRow(
                    label: "Toplam",
                    value: Money.format(minor: report.totalMinor, currency: report.currency),
                    isMonospaced: true
                )
            }
        }
    }
}
