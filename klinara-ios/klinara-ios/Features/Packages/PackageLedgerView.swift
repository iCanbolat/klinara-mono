import SwiftUI

/// Paket defteri — append-only, yeniden eskiye.
///
/// Defter bir "işlem geçmişi" listesi değil, kalan hakkın **kaynağı**dır:
/// satırların toplamı kalan haktır. Bu yüzden düzeltmeler de silinmez, ters
/// kayıt olarak görünür; "neden 6 değil 5?" sorusu ancak böyle cevaplanır.
struct PackageLedgerView: View {

    let session: AppSession
    let store: CustomerPackagesStore
    let packageId: String

    private var clock: BranchClock { session.clock }

    var body: some View {
        switch store.ledger(for: packageId) {
        case .loading:
            KlinaraCard(title: "Defter") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.loadLedger(packageId: packageId) } })

        case .loaded(let entries):
            KlinaraCard(
                title: "Defter",
                footnote: "Satırlar değiştirilemez ve silinemez. Düzeltmeler ters kayıt olarak eklenir."
            ) {
                if entries.isEmpty {
                    KlinaraRow(label: "Henüz kayıt yok")
                } else {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { KlinaraDivider() }
                        row(entry)
                    }
                }
            }

            if store.canLoadMoreLedger(for: packageId) {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, KlinaraMetrics.md)
                    .onAppear { Task { await store.loadMoreLedger(packageId: packageId) } }
            }
        }
    }

    private func row(_ entry: PackageLedgerEntry) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.serviceName)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(clock.formatDateTime(entry.createdAt))
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }

                // İşaret her zaman yazılır: "1" ile "+1" arasındaki fark
                // deftere bakan kişi için hakkın yönü demek.
                Text(entry.signedDelta)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(entry.delta > 0 ? KlinaraColor.sageDeep : KlinaraColor.charcoal)
                    .monospacedDigit()
                    .fixedSize()
            }

            HStack(spacing: KlinaraMetrics.xs) {
                KlinaraBadge(
                    text: entry.entryType.turkishName,
                    tone: entry.entryType.badgeTone,
                    icon: entry.entryType.icon
                )
                if entry.isReversal {
                    KlinaraBadge(text: "Ters kayıt", tone: .warning, icon: "arrow.uturn.left")
                }
            }

            if let reason = entry.reason, !reason.isEmpty {
                Text(reason)
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(KlinaraMetrics.md)
    }
}
