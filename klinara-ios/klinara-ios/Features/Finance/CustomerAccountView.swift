import SwiftUI

/// Müşterinin tam cari defteri — borç kalemleri ve tahsilatlar bir arada.
///
/// Kart bölümü "ne kadar ödeyecek?" sorusunu cevaplıyor; bu ekran "bu para
/// nereden geldi?" sorusunu. İkisini tek yere sığdırmak, kasada bakılan sayıyı
/// otuz satırın arasına gömerdi.
struct CustomerAccountView: View {

    let session: AppSession
    let store: CustomerAccountStore

    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.financePaymentWrite) }

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

                case .loaded(let account):
                    summaryCard(account)
                    paymentsCard
                    entriesCard(account)

                    if store.nextEntryCursor != nil {
                        ProgressView()
                            .tint(KlinaraColor.sage)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, KlinaraMetrics.md)
                            .onAppear { Task { await store.loadMoreEntries() } }
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Cari hesap")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func summaryCard(_ account: CustomerAccount) -> some View {
        KlinaraCard(
            title: "Özet",
            footnote: "Bakiye = açık borç kalemleri − tahsilatlar. Ayrıca saklanmaz, her seferinde hesaplanır."
        ) {
            KlinaraRow(
                label: "Toplam borç",
                value: Money.format(minor: account.chargedMinor, currency: account.currency),
                isMonospaced: true
            )
            KlinaraDivider()
            KlinaraRow(
                label: "Tahsil edilen",
                value: Money.format(minor: account.paidMinor, currency: account.currency),
                isMonospaced: true
            )
            KlinaraDivider()
            KlinaraRow(
                label: account.hasCredit ? "Müşterinin alacağı" : "Kalan bakiye",
                value: Money.format(minor: abs(account.balanceMinor), currency: account.currency),
                isMonospaced: true
            )
        }
    }

    /// Tahsilatlar ayrı bir kartta: makbuz numarası ve iptal yolu buradan
    /// geçiyor ve karışık bir defterde makbuzu bulmak zor.
    @ViewBuilder
    private var paymentsCard: some View {
        if !store.payments.isEmpty {
            KlinaraCard(title: "Tahsilatlar") {
                ForEach(Array(store.payments.enumerated()), id: \.element.id) { index, payment in
                    if index > 0 { KlinaraDivider() }
                    NavigationLink {
                        PaymentDetailView(session: session, store: store, paymentId: payment.id)
                    } label: {
                        paymentRow(payment)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func paymentRow(_ payment: Payment) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                Text("Makbuz #\(payment.receiptNo)")
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(Money.format(minor: payment.amountMinor, currency: payment.currency))
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()
                    .fixedSize()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }

            Text("\(payment.method.turkishName) · \(clock.formatDateTime(payment.paidAt))")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: KlinaraMetrics.xs) {
                if payment.status == .void {
                    KlinaraBadge(text: "İptal", tone: .muted)
                }
                if payment.hasAdvance, payment.status == .posted {
                    KlinaraBadge(
                        text: "Avans \(Money.format(minor: payment.unallocatedMinor))",
                        tone: .neutral
                    )
                }
            }
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)
    }

    private func entriesCard(_ account: CustomerAccount) -> some View {
        KlinaraCard(title: "Hareketler", footnote: "Borç pozitif, tahsilat negatif görünür.") {
            if account.entries.isEmpty {
                KlinaraRow(label: "Henüz hareket yok")
            } else {
                ForEach(Array(account.entries.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { KlinaraDivider() }
                    entryRow(entry)
                }
            }
        }
    }

    private func entryRow(_ entry: AccountEntry) -> some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.md) {
            Image(systemName: entry.entryKind.icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(
                    entry.amountMinor < 0 ? KlinaraColor.sageDeep : KlinaraColor.charcoalMuted
                )
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.description)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text("\(entry.entryKind.turkishName) · \(clock.formatDateTime(entry.occurredAt))")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            // İşaret her zaman yazılıyor, artı dahil: bir defterde işaretsiz
            // rakam hangi yöne gittiğini söylemez.
            Text(signed(entry))
                .klinaraText(.bodyM)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .fixedSize()
        }
        .padding(KlinaraMetrics.md)
    }

    private func signed(_ entry: AccountEntry) -> String {
        let formatted = Money.format(minor: abs(entry.amountMinor), currency: entry.currency)
        return entry.amountMinor < 0 ? "−\(formatted)" : "+\(formatted)"
    }
}
