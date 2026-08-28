import SwiftUI

/// Müşteri kartının cari hesap bölümü.
///
/// Kartta gösterilen şey **bakiye ve açık kalemler**dir, işlem geçmişi değil:
/// resepsiyonun kasada sorduğu soru "ne kadar ödeyecek?" — tam defter bir alt
/// ekranda duruyor.
///
/// Bölüm yalnız `finance.payment:read` varsa çizilir; izinsiz kullanıcıya boş
/// bir "Cari hesap" kartı göstermek, yapamayacağı bir şeyi vaat etmektir.
struct CustomerAccountSection: View {

    let session: AppSession
    let store: CustomerAccountStore

    @State private var isCollecting = false
    @State private var isAddingCharge = false

    private var canWrite: Bool { session.can(Permissions.financePaymentWrite) }

    var body: some View {
        switch store.state {
        case .loading:
            KlinaraCard(title: "Cari hesap") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.load() } })

        case .loaded(let account):
            KlinaraCard(title: "Cari hesap", footnote: footnote(account)) {
                balanceRow(account)
                KlinaraDivider()
                totalsRow(account)

                if !store.openCharges.isEmpty {
                    KlinaraDivider()
                    openChargesHeader
                    ForEach(store.openCharges) { charge in
                        KlinaraDivider()
                        chargeRow(charge)
                    }
                }

                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Tüm hareketler",
                    detail: "Borç kalemleri ve tahsilatlar",
                    icon: "list.bullet.rectangle.portrait"
                ) {
                    CustomerAccountView(session: session, store: store)
                }

                if canWrite {
                    KlinaraDivider()
                    actionRow(
                        title: "Tahsilat al",
                        icon: "banknote",
                        action: { isCollecting = true }
                    )
                    KlinaraDivider()
                    actionRow(
                        title: "Kalem ekle",
                        icon: "plus.circle",
                        action: { isAddingCharge = true }
                    )
                }
            }
            .sheet(isPresented: $isCollecting) {
                CollectPaymentSheet(session: session, store: store)
            }
            .sheet(isPresented: $isAddingCharge) {
                ChargeEditorSheet(session: session, store: store)
            }
        }
    }

    // MARK: Parçalar

    /// Bakiyenin **işareti** ekranda yazıyla söyleniyor. "−250,00 ₺" tek başına
    /// müşterinin mi kliniğin mi borçlu olduğunu söylemez ve kasada yanlış
    /// tarafa para vermeye yol açar.
    private func balanceRow(_ account: CustomerAccount) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(balanceLabel(account))
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                Text(Money.format(minor: abs(account.balanceMinor), currency: account.currency))
                    .klinaraText(.displayM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            KlinaraBadge(text: balanceBadge(account), tone: balanceTone(account))
        }
        .padding(KlinaraMetrics.md)
    }

    private func totalsRow(_ account: CustomerAccount) -> some View {
        KlinaraRow(
            label: "Toplam borç",
            value: Money.format(minor: account.chargedMinor, currency: account.currency),
            detail: "Tahsil edilen: \(Money.format(minor: account.paidMinor, currency: account.currency))",
            isMonospaced: true
        )
    }

    private var openChargesHeader: some View {
        Text("Açık kalemler")
            .klinaraText(.label)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, KlinaraMetrics.md)
            .padding(.top, KlinaraMetrics.md)
    }

    /// Kalemde iki tutar var: **toplam** ve **kalan**. Yalnız toplamı
    /// göstermek, üzerine kısmi tahsilat yapılmış bir kalemi kapanmamış gibi
    /// tam tutarıyla tahsile götürürdü.
    private func chargeRow(_ charge: Charge) -> some View {
        let remaining = store.remainingBalance(of: charge)
        let isPartial = remaining != charge.totalMinor
        return KlinaraRow(
            label: charge.description,
            value: Money.format(minor: remaining, currency: charge.currency),
            detail: isPartial
                ? "\(charge.source.turkishName) · Toplam \(Money.format(minor: charge.totalMinor, currency: charge.currency))"
                : charge.source.turkishName,
            isMonospaced: true
        )
    }

    private func actionRow(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.sageDeep)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KlinaraMetrics.md)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    // MARK: Metinler

    private func balanceLabel(_ account: CustomerAccount) -> String {
        if account.isSettled { return "Bakiye kapalı" }
        return account.hasCredit ? "Müşterinin alacağı" : "Müşterinin borcu"
    }

    private func balanceBadge(_ account: CustomerAccount) -> String {
        if account.isSettled { return "Kapalı" }
        return account.hasCredit ? "Avans" : "Borçlu"
    }

    private func balanceTone(_ account: CustomerAccount) -> KlinaraBadge.Tone {
        if account.isSettled { return .positive }
        return account.hasCredit ? .neutral : .warning
    }

    private func footnote(_ account: CustomerAccount) -> String? {
        guard !store.openCharges.isEmpty else { return nil }
        let count = store.openCharges.count
        // KDV'nin fiyata dahil olduğunu bir kez söylemek gerekiyor: kasada
        // "üstüne KDV var mı?" sorusu her gün soruluyor.
        return "\(count) açık kalem. Tutarlar KDV dahildir."
    }
}
