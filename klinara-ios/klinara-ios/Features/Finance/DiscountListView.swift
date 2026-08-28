import SwiftUI

/// İndirim tanımları.
///
/// İndirim **katalog kartında** duruyor, finans kartında değil: `service:read`
/// / `service:write` ile korunuyor ve bir indirim tanımı, günlük tahsilattan
/// çok bir fiyat kararı. Sunucudaki izin seçimi bu bilgi mimarisini zaten
/// söylüyor; ekranın onu bozması, resepsiyonun kampanya tanımlamasına yol
/// açacak bir düğme göstermek olurdu.
struct DiscountListView: View {

    let session: AppSession

    @State private var isCreating = false
    @State private var editing: Discount?

    private var store: DiscountStore { session.discountStore }
    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.serviceWrite) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                switch store.state {
                case .loading:
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)

                case .failed(let error):
                    ErrorBanner(error: error, onRetry: { Task { await store.reload() } })

                case .loaded(let discounts):
                    if discounts.isEmpty {
                        EmptyStateView(
                            icon: "tag",
                            title: "İndirim yok",
                            message: "Kampanya kodu olan ya da elle seçilen indirimler burada tanımlanır.",
                            actionTitle: canWrite ? "İndirim ekle" : nil,
                            action: canWrite ? { isCreating = true } : nil
                        )
                    } else {
                        KlinaraCard(
                            title: "İndirimler",
                            footnote: "Süresi dolmuş ve hakkı tükenmiş indirimler kalem açarken seçilemez."
                        ) {
                            ForEach(Array(discounts.enumerated()), id: \.element.id) { index, discount in
                                if index > 0 { KlinaraDivider() }
                                row(discount)
                            }
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
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("İndirimler")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isCreating = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .task { await store.load() }
        .sheet(isPresented: $isCreating) {
            DiscountEditorView(session: session)
        }
        .sheet(item: $editing) { discount in
            DiscountEditorView(session: session, editing: discount)
        }
    }

    private func row(_ discount: Discount) -> some View {
        Button {
            guard canWrite else { return }
            editing = discount
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                    Text(discount.name)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(discount.valueLabel)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .monospacedDigit()
                        .fixedSize()

                    if canWrite {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                    }
                }

                Text(summary(discount))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: KlinaraMetrics.xs) {
                    if !discount.isActive {
                        KlinaraBadge(text: "Pasif", tone: .muted)
                    } else if !discount.isSelectable() {
                        // "Pasif" ile "kullanılamaz" farkı: aktif ama süresi
                        // dolmuş bir indirim yönetimde durur, seçicide durmaz.
                        KlinaraBadge(text: "Kullanılamaz", tone: .warning, icon: "hourglass")
                    }
                    if let max = discount.maxRedemptions {
                        KlinaraBadge(text: "\(discount.redeemedCount)/\(max)", tone: .neutral)
                    }
                }
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func summary(_ discount: Discount) -> String {
        var parts: [String] = [discount.scope.turkishName]
        if let code = discount.code { parts.append("Kod: \(code)") }
        switch (discount.startsAt, discount.endsAt) {
        case (let start?, let end?):
            parts.append("\(clock.formatDate(start)) – \(clock.formatDate(end))")
        case (let start?, nil):
            parts.append("\(clock.formatDate(start))'den itibaren")
        case (nil, let end?):
            parts.append("\(clock.formatDate(end))'e kadar")
        case (nil, nil):
            parts.append("Süresiz")
        }
        return parts.joined(separator: " · ")
    }
}
