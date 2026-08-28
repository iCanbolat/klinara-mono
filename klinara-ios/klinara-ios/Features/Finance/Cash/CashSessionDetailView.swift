import SwiftUI

/// Kasa oturumu özeti: beklenen tutar, yöntem kırılımı ve hareket dökümü.
///
/// **Beklenen tutar ile yöntem kırılımı ayrı şeyler.** Çekmecede olması gereken
/// para yalnız nakit hareketlerden doğar; kart ve havale tahsilatları kırılımda
/// görünür ama beklenen tutara girmez. İkisini tek toplamda birleştirmek,
/// sayımı her akşam tutmaz kılardı.
struct CashSessionDetailView: View {

    let session: AppSession
    let sessionId: String

    @State private var isClosing = false

    private var store: CashSessionStore { session.cashSessionStore }
    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.financePaymentWrite) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                switch store.summary(for: sessionId) {
                case .loading:
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)

                case .failed(let error):
                    ErrorBanner(error: error, onRetry: {
                        Task { await store.loadSummary(sessionId: sessionId) }
                    })

                case .loaded(let summary):
                    statusCard(summary)
                    methodsCard(summary)
                    movementsCard(summary)

                    if summary.session.isOpen, canWrite {
                        KlinaraButton(title: "Kasayı kapat", kind: .primary, icon: "tray.and.arrow.up") {
                            isClosing = true
                        }
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Kasa oturumu")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadSummary(sessionId: sessionId) }
        .sheet(isPresented: $isClosing) {
            if let summary = store.summary(for: sessionId).value {
                CloseCashSheet(session: session, summary: summary)
            }
        }
    }

    private func statusCard(_ summary: CashSessionSummary) -> some View {
        let cash = summary.session
        return KlinaraCard(title: "Durum", footnote: statusFootnote(cash)) {
            KlinaraRow(label: "Durum", value: cash.status.turkishName)
            KlinaraDivider()
            KlinaraRow(label: "Açılış", value: clock.formatDateTime(cash.openedAt))
            KlinaraDivider()
            KlinaraRow(
                label: "Açılış bakiyesi",
                value: Money.format(minor: cash.openingBalanceMinor, currency: cash.currency),
                isMonospaced: true
            )
            KlinaraDivider()
            KlinaraRow(
                label: cash.isOpen ? "Şu an beklenen nakit" : "Kapanışta beklenen",
                value: Money.format(
                    minor: cash.isOpen ? summary.expectedMinor : (cash.expectedMinor ?? summary.expectedMinor),
                    currency: cash.currency
                ),
                isMonospaced: true
            )

            if let counted = cash.countedMinor {
                KlinaraDivider()
                KlinaraRow(
                    label: "Sayılan",
                    value: Money.format(minor: counted, currency: cash.currency),
                    isMonospaced: true
                )
            }
            if let difference = cash.differenceMinor {
                KlinaraDivider()
                KlinaraRow(
                    label: "Fark",
                    value: signed(difference, currency: cash.currency),
                    detail: cash.differenceReason,
                    isMonospaced: true
                )
            }
            if let closedAt = cash.closedAt {
                KlinaraDivider()
                KlinaraRow(label: "Kapanış", value: clock.formatDateTime(closedAt))
            }
        }
    }

    private func statusFootnote(_ cash: CashSession) -> String {
        cash.isOpen
            ? "Beklenen tutar yalnız NAKİT hareketlerden doğar; kart ve havale çekmeceye girmez."
            : "Kapanışta hesaplanan beklenen tutar dondurulmuştur."
    }

    private func methodsCard(_ summary: CashSessionSummary) -> some View {
        KlinaraCard(
            title: "Yöntem kırılımı",
            footnote: "Oturumdaki tüm tahsilatlar — nakit dışı yöntemler dahil."
        ) {
            if summary.byMethod.isEmpty {
                KlinaraRow(label: "Bu oturumda tahsilat yok")
            } else {
                ForEach(Array(summary.byMethod.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { KlinaraDivider() }
                    KlinaraRow(
                        label: row.method.turkishName,
                        value: Money.format(minor: row.amountMinor),
                        detail: "\(row.count) işlem",
                        isMonospaced: true
                    )
                }
            }
        }
    }

    private func movementsCard(_ summary: CashSessionSummary) -> some View {
        KlinaraCard(title: "Hareketler", footnote: "Giriş pozitif, çıkış negatif. Silinmez.") {
            if summary.movements.isEmpty {
                KlinaraRow(label: "Hareket yok")
            } else {
                ForEach(Array(summary.movements.reversed().enumerated()), id: \.element.id) { index, movement in
                    if index > 0 { KlinaraDivider() }
                    movementRow(movement, currency: summary.session.currency)
                }
            }
        }
    }

    private func movementRow(_ movement: CashMovement, currency: String) -> some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.md) {
            Image(systemName: movement.kind.icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(
                    movement.amountMinor < 0 ? KlinaraColor.danger : KlinaraColor.sageDeep
                )
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(movement.kind.turkishName)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(movement.note ?? clock.formatDateTime(movement.createdAt))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Text(signed(movement.amountMinor, currency: currency))
                .klinaraText(.bodyM)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .fixedSize()
        }
        .padding(KlinaraMetrics.md)
    }

    private func signed(_ minor: Int, currency: String) -> String {
        let formatted = Money.format(minor: abs(minor), currency: currency)
        return minor < 0 ? "−\(formatted)" : "+\(formatted)"
    }
}
