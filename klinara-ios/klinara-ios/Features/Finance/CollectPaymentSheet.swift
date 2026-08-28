import SwiftUI

/// Tahsilat alma: yöntem → tutar → dağıtım.
///
/// **Idempotency anahtarı sheet açılışında üretilir ve tahsilat boyunca sabit
/// kalır** (Faz 5'in satış sheet'iyle aynı gerekçe): ağ hatasından sonra
/// kullanıcının tekrar basması çok olası ve her denemede yeni anahtar üretmek
/// müşteriden iki kez para almak demekti.
///
/// Dağıtım varsayılan olarak **otomatik**: sunucu açık kalemlere eskiden yeniye
/// dağıtır. Elle dağıtım isteyen kullanıcı geçiş yapabilir; toplam tahsilat
/// tutarını aşarsa düğme kapanır — sunucu da `PAYMENT_EXCEEDS_BALANCE` ile
/// reddederdi ama kullanıcıya 409 göstermek gereksiz.
struct CollectPaymentSheet: View {

    let session: AppSession
    let store: CustomerAccountStore

    @Environment(\.dismiss) private var dismiss

    @State private var method: PaymentMethod = .cash
    @State private var amountMinor: Int?
    @State private var isManualAllocation = false
    /// `chargeId` → elle girilen tahsis tutarı.
    @State private var allocations: [String: Int] = [:]
    @State private var note = ""
    @State private var error: APIError?
    /// Sheet ömrü boyunca tek anahtar — `@State` olması kasıtlı.
    @State private var idempotencyKey = UUID().uuidString

    private var cashStore: CashSessionStore { session.cashSessionStore }

    private var openCashSession: CashSession? {
        cashStore.openSession(in: session.selectedBranchId)
    }

    /// Nakit, açık bir kasa oturumu olmadan yazılamaz (Batch 6.3). Düğmeyi
    /// kapatıp sebebini söylemek, `CASH_SESSION_REQUIRED` göstermekten iyi.
    private var isCashBlocked: Bool {
        method.requiresCashSession && openCashSession == nil
    }

    private var allocatedTotal: Int {
        allocations.values.reduce(0, +)
    }

    private var isOverAllocated: Bool {
        isManualAllocation && allocatedTotal > (amountMinor ?? 0)
    }

    private var canSubmit: Bool {
        guard let amountMinor, amountMinor > 0 else { return false }
        guard !isCashBlocked, !isOverAllocated, !store.isSaving else { return false }
        if isManualAllocation, allocatedTotal == 0 { return false }
        return true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    balanceCard
                    methodCard
                    amountCard
                    allocationCard
                    noteCard
                    submitButton
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Tahsilat al")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task { await cashStore.loadIfNeeded() }
            .overlay {
                if store.isSaving { AuthLoadingOverlay(message: "Tahsilat kaydediliyor…") }
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Bölümler

    @ViewBuilder
    private var balanceCard: some View {
        if let account = store.account {
            KlinaraCard(title: "Bakiye") {
                KlinaraRow(
                    label: account.hasCredit ? "Müşterinin alacağı" : "Ödenecek tutar",
                    value: Money.format(minor: abs(account.balanceMinor), currency: account.currency),
                    detail: "Açık kalem: \(store.openCharges.count)",
                    isMonospaced: true
                )
                if account.balanceMinor > 0 {
                    KlinaraDivider()
                    Button {
                        amountMinor = account.balanceMinor
                    } label: {
                        Label("Tamamını tahsil et", systemImage: "equal.circle")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.sageDeep)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(KlinaraMetrics.md)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var methodCard: some View {
        KlinaraCard(title: "Yöntem", footnote: methodFootnote) {
            ForEach(Array(PaymentMethod.allCases.enumerated()), id: \.element.id) { index, option in
                if index > 0 { KlinaraDivider() }
                Button {
                    method = option
                } label: {
                    KlinaraRow(label: option.turkishName) {
                        Image(systemName: method == option ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(
                                method == option ? KlinaraColor.sageDeep : KlinaraColor.border
                            )
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var methodFootnote: String {
        guard method.requiresCashSession else {
            return "Nakit dışı tahsilatlar kasa oturumuna bağlanmaz."
        }
        guard let openCashSession else {
            return "Nakit tahsilat için açık bir kasa gerekir. Yönetim → Kasa'dan kasayı açın."
        }
        return "Kasa \(session.clock.formatTime(openCashSession.openedAt))'de açıldı; tahsilat bu oturuma yazılacak."
    }

    private var amountCard: some View {
        KlinaraCard(title: "Tutar") {
            KlinaraMoneyField(
                label: "Tahsil edilen",
                amountMinor: $amountMinor,
                error: error?.fieldErrors["amountMinor"]
            )
            .padding(KlinaraMetrics.md)
        }
    }

    /// Dağıtım editörü. Otomatik mod sunucunun kuralını **anlatır**, taklit
    /// etmez: istemcide bir dağıtım hesaplayıp göndermek, iki farklı sıralama
    /// mantığının bir gün ayrışması demekti.
    private var allocationCard: some View {
        KlinaraCard(title: "Dağıtım", footnote: allocationFootnote) {
            KlinaraToggleRow(
                label: "Kalemleri elle seç",
                detail: "Kapalıysa açık kalemlere eskiden yeniye dağıtılır.",
                isOn: $isManualAllocation
            )

            if isManualAllocation {
                if store.openCharges.isEmpty {
                    KlinaraDivider()
                    KlinaraRow(label: "Açık kalem yok", detail: "Tahsilat tamamı avans olarak kalır.")
                } else {
                    ForEach(store.openCharges) { charge in
                        KlinaraDivider()
                        allocationRow(charge)
                    }
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Dağıtılan",
                        value: Money.format(minor: allocatedTotal),
                        detail: isOverAllocated
                            ? "Tahsilat tutarını aşıyor."
                            : "Kalan \(Money.format(minor: max(0, (amountMinor ?? 0) - allocatedTotal))) avans olarak kalır.",
                        isMonospaced: true
                    )
                }
            }
        }
    }

    private func allocationRow(_ charge: Charge) -> some View {
        let remaining = store.remainingBalance(of: charge)
        return VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                Text(charge.description)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button("Tümü") {
                    allocations[charge.id] = remaining
                }
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.sageDeep)
            }

            KlinaraMoneyField(
                label: "Açık: \(Money.format(minor: remaining, currency: charge.currency))",
                amountMinor: Binding(
                    get: { allocations[charge.id] },
                    set: { allocations[charge.id] = $0 }
                ),
                // Bir kaleme kalemin açık bakiyesinden fazlası tahsis edilemez;
                // sunucu `K0013` ile reddediyor, burada alan hatası olarak çıkıyor.
                error: (allocations[charge.id] ?? 0) > remaining
                    ? "Kalemin açık bakiyesinden fazla tahsis edilemez."
                    : nil
            )
        }
        .padding(KlinaraMetrics.md)
    }

    private var allocationFootnote: String {
        isManualAllocation
            ? "Bir kaleme, kalemin açık bakiyesinden fazlası tahsis edilemez."
            : "Artan tutar avans olarak müşterinin hesabında kalır."
    }

    private var noteCard: some View {
        KlinaraCard(title: "Not") {
            KlinaraTextEditor(
                label: "Tahsilat notu",
                text: $note,
                placeholder: "İsteğe bağlı",
                error: error?.fieldErrors["note"],
                minHeight: 80
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private var submitButton: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            KlinaraButton(
                title: "Tahsilatı kaydet",
                kind: .primary,
                icon: "banknote",
                isLoading: store.isSaving,
                isEnabled: canSubmit
            ) {
                Task { await submit() }
            }

            if isCashBlocked {
                Text("Nakit tahsilat için önce kasayı açmalısınız.")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.danger)
            }
        }
    }

    // MARK: Eylem

    private func submit() async {
        guard let amountMinor else { return }
        error = nil
        let lines: [PaymentAllocationInput]? = isManualAllocation
            ? allocations
                .filter { $0.value > 0 }
                .map { PaymentAllocationInput(chargeId: $0.key, amountMinor: $0.value) }
                .sorted { $0.chargeId < $1.chargeId }
            : nil

        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await store.createPayment(
                CreatePaymentInput(
                    customerId: store.customerId,
                    method: method,
                    amountMinor: amountMinor,
                    allocations: lines,
                    paidAt: nil,
                    cashSessionId: method.requiresCashSession ? openCashSession?.id : nil,
                    note: trimmed.isEmpty ? nil : trimmed
                ),
                idempotencyKey: idempotencyKey
            )
            // Kasa özeti de tazeleniyor: nakit tahsilat beklenen tutarı
            // değiştirdi ve kasa ekranı eski rakamı gösterirse sayım tutmaz.
            if let sessionId = openCashSession?.id {
                await cashStore.refreshSummaryIfLoaded(sessionId: sessionId)
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
