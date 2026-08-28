import SwiftUI

/// Kasa oturumları — açık oturum en üstte, geçmiş altında.
///
/// Kasa Yönetim hub'ında duruyor, ayrı bir sekmede değil: sekme kümesi Faz 3'te
/// donduruldu ve bir sekme daha açmak kullanıcının kas hafızasını sıfırlardı.
struct CashSessionListView: View {

    let session: AppSession

    @State private var isOpening = false
    @State private var isRefunding = false

    private var store: CashSessionStore { session.cashSessionStore }
    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.financePaymentWrite) }

    private var openSession: CashSession? {
        store.openSession(in: session.selectedBranchId)
    }

    private var closedSessions: [CashSession] {
        store.sessions.filter { !$0.isOpen }
    }

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
                    ErrorBanner(error: error, onRetry: { Task { await store.load() } })

                case .loaded:
                    currentCard
                    historyCard

                    if store.nextCursor != nil {
                        ProgressView()
                            .tint(KlinaraColor.sage)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, KlinaraMetrics.md)
                            .onAppear { Task { await store.loadMore() } }
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Kasa")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.load() }
        .sheet(isPresented: $isOpening) {
            OpenCashSheet(session: session)
        }
        .sheet(isPresented: $isRefunding) {
            RefundSheet(session: session)
        }
    }

    /// Açık kasa **ayrı bir kartta** ve en üstte: gün içinde bakılan tek şey o.
    /// Geçmişin arasına karışmış bir "açık" satırı her seferinde aranırdı.
    @ViewBuilder
    private var currentCard: some View {
        if let openSession {
            KlinaraCard(
                title: "Açık kasa",
                footnote: "Nakit tahsilat ve iadeler bu oturuma yazılır."
            ) {
                KlinaraNavigationRow(
                    label: "Oturum özeti",
                    value: clock.formatTime(openSession.openedAt),
                    detail: "Açılış: \(Money.format(minor: openSession.openingBalanceMinor, currency: openSession.currency))",
                    icon: "tray.full"
                ) {
                    CashSessionDetailView(session: session, sessionId: openSession.id)
                }

                if canWrite {
                    KlinaraDivider()
                    Button {
                        isRefunding = true
                    } label: {
                        Label("İade yap", systemImage: "arrow.uturn.backward")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.sageDeep)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(KlinaraMetrics.md)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        } else {
            KlinaraCard(
                title: "Açık kasa yok",
                footnote: "Nakit tahsilat için önce kasayı açmalısınız. Şube başına yalnız bir kasa açık olabilir."
            ) {
                if canWrite {
                    Button {
                        isOpening = true
                    } label: {
                        Label("Kasa aç", systemImage: "tray.and.arrow.down")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.sageDeep)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(KlinaraMetrics.md)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                } else {
                    KlinaraRow(label: "Kasa açma yetkiniz yok")
                }
            }
        }
    }

    private var historyCard: some View {
        KlinaraCard(title: "Geçmiş oturumlar") {
            if closedSessions.isEmpty {
                KlinaraRow(label: "Kapanmış kasa yok")
            } else {
                ForEach(Array(closedSessions.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { KlinaraDivider() }
                    NavigationLink {
                        CashSessionDetailView(session: session, sessionId: item.id)
                    } label: {
                        historyRow(item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func historyRow(_ item: CashSession) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                Text(clock.formatDate(item.openedAt))
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(Money.format(minor: item.countedMinor ?? 0, currency: item.currency))
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()
                    .fixedSize()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }

            Text(rangeLabel(item))
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Fark rozeti kapanışın en önemli bilgisi: tutmayan bir sayım
            // listede görünmezse ancak ay sonunda fark edilir.
            if item.hasDifference, let difference = item.differenceMinor {
                KlinaraBadge(
                    text: "Fark \(signed(difference, currency: item.currency))",
                    tone: .warning,
                    icon: "exclamationmark.triangle"
                )
            }
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)
    }

    private func rangeLabel(_ item: CashSession) -> String {
        guard let closedAt = item.closedAt else { return "Açık" }
        return "\(clock.formatTime(item.openedAt)) – \(clock.formatTime(closedAt))"
    }

    private func signed(_ minor: Int, currency: String) -> String {
        let formatted = Money.format(minor: abs(minor), currency: currency)
        return minor < 0 ? "−\(formatted)" : "+\(formatted)"
    }
}
