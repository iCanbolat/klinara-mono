import SwiftUI

/// Prim kuralları.
///
/// Liste **çözüm sırasına** göre dizili: personel bazlı override en üstte,
/// sonra kapsamlı kurallar, en altta genel kural. Alfabetik bir sıra
/// kullanıcının asıl sorusunu — "çakışırlarsa hangisi kazanır?" —
/// cevaplamazdı; sunucu bu soruyu tek bir kuralla cevaplıyor ve ekran da o
/// sırayı göstermeli.
struct CommissionRuleListView: View {

    let session: AppSession
    let store: CommissionStore

    @State private var isCreating = false
    @State private var editing: CommissionRule?

    private var canWrite: Bool { session.can(Permissions.financeCommissionWrite) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                switch store.rulesState {
                case .loading:
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)

                case .failed(let error):
                    ErrorBanner(error: error, onRetry: { Task { await store.loadRules() } })

                case .loaded(let rules):
                    if rules.isEmpty {
                        EmptyStateView(
                            icon: "slider.horizontal.3",
                            title: "Prim kuralı yok",
                            message: canWrite
                                ? "Bir kural tanımlayana kadar prim tahakkuk etmez."
                                : "Henüz prim kuralı tanımlanmamış.",
                            actionTitle: canWrite ? "Kural ekle" : nil,
                            action: canWrite ? { isCreating = true } : nil
                        )
                    } else {
                        KlinaraCard(
                            title: "Kurallar",
                            footnote: "Çakışmada TEK kural uygulanır: personel bazlı > kapsamlı > genel, sonra öncelik."
                        ) {
                            ForEach(Array(rules.enumerated()), id: \.element.id) { index, rule in
                                if index > 0 { KlinaraDivider() }
                                row(rule)
                            }
                        }

                        if store.ruleCursor != nil {
                            ProgressView()
                                .tint(KlinaraColor.sage)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, KlinaraMetrics.md)
                                .onAppear { Task { await store.loadMoreRules() } }
                        }
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Prim kuralları")
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
        .task { await store.loadRules() }
        .sheet(isPresented: $isCreating) {
            CommissionRuleEditorView(session: session, store: store)
        }
        .sheet(item: $editing) { rule in
            CommissionRuleEditorView(session: session, store: store, editing: rule)
        }
    }

    private func row(_ rule: CommissionRule) -> some View {
        Button {
            guard canWrite else { return }
            editing = rule
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                    Text(rule.name)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(rule.valueLabel)
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

                Text(summary(rule))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: KlinaraMetrics.xs) {
                    if !rule.isActive {
                        KlinaraBadge(text: "Pasif", tone: .muted)
                    }
                    if rule.staffProfileId != nil {
                        KlinaraBadge(text: "Personel bazlı", tone: .neutral, icon: "person")
                    }
                    // Kaydedilebilen ama henüz prim üretmeyen kapsamlar
                    // rozetle işaretli: sessizce çalışmayan bir kural,
                    // ay sonunda "primim nerede" sorusuna dönüşür.
                    if !rule.scope.accruesToday {
                        KlinaraBadge(text: "Henüz tahakkuk etmiyor", tone: .warning, icon: "hourglass")
                    }
                }
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func summary(_ rule: CommissionRule) -> String {
        var parts = [rule.scope.turkishName, rule.basis.turkishName, rule.triggerOn.turkishName]
        parts.append("Öncelik \(rule.priority)")
        if let from = rule.effectiveFrom {
            parts.append(rule.effectiveTo.map { "\(from) – \($0)" } ?? "\(from)'den itibaren")
        }
        return parts.joined(separator: " · ")
    }
}
