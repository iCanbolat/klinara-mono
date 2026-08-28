import SwiftUI

/// Müşteri kartının paket bölümü.
///
/// Kartta gösterilen şey **kalan hak**tır, satış geçmişi değil: resepsiyonun
/// randevu açarken sorduğu soru "kaç seansı kaldı?" — kapanmış paketler
/// listenin sonuna düşer.
struct CustomerPackagesSection: View {

    let session: AppSession
    let store: CustomerPackagesStore

    @State private var isSelling = false

    private var canWrite: Bool { session.can(Permissions.packageWrite) }
    private var clock: BranchClock { session.clock }

    var body: some View {
        switch store.state {
        case .loading:
            KlinaraCard(title: "Paketler") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.load() } })

        case .loaded(let packages):
            KlinaraCard(title: "Paketler", footnote: footnote) {
                if packages.isEmpty {
                    KlinaraRow(label: "Henüz paket yok")
                } else {
                    ForEach(Array(ordered(packages).enumerated()), id: \.element.id) { index, item in
                        if index > 0 { KlinaraDivider() }
                        row(item)
                    }
                }

                if canWrite {
                    KlinaraDivider()
                    Button {
                        isSelling = true
                    } label: {
                        Label("Paket sat", systemImage: "cart.badge.plus")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.sageDeep)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(KlinaraMetrics.md)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
            .sheet(isPresented: $isSelling) {
                SellPackageSheet(session: session, store: store)
            }

            if store.nextCursor != nil {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, KlinaraMetrics.md)
                    .onAppear { Task { await store.loadMore() } }
            }
        }
    }

    private var footnote: String? {
        let remaining = store.totalRemainingSessions
        guard remaining > 0 else { return nil }
        return "Toplam \(remaining) seans hakkı var."
    }

    /// Açık paketler önce, sonra kapanmışlar; her grup içinde yeni satış üstte.
    private func ordered(_ packages: [CustomerPackage]) -> [CustomerPackage] {
        packages.sorted { lhs, rhs in
            let lhsOpen = lhs.status == .active && lhs.remainingSessions > 0
            let rhsOpen = rhs.status == .active && rhs.remainingSessions > 0
            if lhsOpen != rhsOpen { return lhsOpen }
            return lhs.soldAt > rhs.soldAt
        }
    }

    private func row(_ item: CustomerPackage) -> some View {
        NavigationLink {
            CustomerPackageDetailView(session: session, store: store, packageId: item.id)
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                    Text(item.name)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text("\(item.remainingSessions)/\(item.totalSessions)")
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .monospacedDigit()
                        .fixedSize()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }

                // Kalem dökümü kartta duruyor: "kalan 7" tek başına hangi
                // hizmetten olduğunu söylemiyor ve fazın var olma sebebi bu.
                Text(itemSummary(item))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: KlinaraMetrics.xs) {
                    if item.status != .active {
                        KlinaraBadge(text: item.status.turkishName, tone: item.status.badgeTone)
                    } else if item.isExpired() {
                        KlinaraBadge(text: "Süresi doldu", tone: .warning, icon: "hourglass")
                    } else if item.expiresSoon() {
                        KlinaraBadge(text: expiryLabel(item), tone: .warning, icon: "hourglass")
                    }
                    if item.remainingSessions == 0, item.status == .active {
                        KlinaraBadge(text: "Hak bitti", tone: .muted)
                    }
                }
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func itemSummary(_ item: CustomerPackage) -> String {
        item.items
            .sorted { $0.sortOrder < $1.sortOrder }
            .map { "\($0.serviceName): \($0.remainingSessions)/\($0.quantityTotal)" }
            .joined(separator: " · ")
    }

    private func expiryLabel(_ item: CustomerPackage) -> String {
        guard let expiresAt = item.expiresAt else { return "Süresiz" }
        return "\(clock.formatDate(expiresAt))'de doluyor"
    }
}
