import SwiftUI

/// Tahakkuk dökümü — hangi işlemden ne kadar prim doğdu.
///
/// Ters kayıtlar **negatif** tutarla ve rozetle görünür. Onları listeden
/// süzmek toplamı raporla tutmaz kılardı; gizlemek ise "primim neden azaldı?"
/// sorusunu cevapsız bırakırdı.
struct CommissionAccrualListView: View {

    let session: AppSession
    let store: CommissionStore

    private var clock: BranchClock { session.clock }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                switch store.accrualsState {
                case .loading:
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)

                case .failed(let error):
                    ErrorBanner(error: error, onRetry: { Task { await store.loadAccruals() } })

                case .loaded(let accruals):
                    if accruals.isEmpty {
                        EmptyStateView(
                            icon: "list.bullet.rectangle.portrait",
                            title: "Tahakkuk yok",
                            message: "Seçilen dönemde prim doğuran bir işlem bulunmuyor."
                        )
                    } else {
                        KlinaraCard(title: "Tahakkuklar", footnote: "Append-only; düzeltmeler ters kayıtla yazılır.") {
                            ForEach(Array(accruals.enumerated()), id: \.element.id) { index, accrual in
                                if index > 0 { KlinaraDivider() }
                                row(accrual)
                            }
                        }

                        if store.accrualCursor != nil {
                            ProgressView()
                                .tint(KlinaraColor.sage)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, KlinaraMetrics.md)
                                .onAppear { Task { await store.loadMoreAccruals() } }
                        }
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Tahakkuklar")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadAccruals() }
    }

    private func row(_ accrual: CommissionAccrual) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                Text(accrual.triggerOn.turkishName)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(signed(accrual.amountMinor))
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(
                        accrual.amountMinor < 0 ? KlinaraColor.danger : KlinaraColor.charcoal
                    )
                    .monospacedDigit()
                    .fixedSize()
            }

            Text("Matrah: \(Money.format(minor: abs(accrual.basisMinor))) · \(accrual.ruleBasis.turkishName)")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(clock.formatDateTime(accrual.createdAt))
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            if accrual.isReversal {
                KlinaraBadge(
                    text: accrual.reason ?? "Ters kayıt",
                    tone: .warning,
                    icon: "arrow.uturn.backward"
                )
            }
        }
        .padding(KlinaraMetrics.md)
    }

    private func signed(_ minor: Int) -> String {
        let formatted = Money.format(minor: abs(minor))
        return minor < 0 ? "−\(formatted)" : formatted
    }
}
