import SwiftUI

/// Hizmet ve diğer iadeler — kasa hareketiyle birlikte.
///
/// **Paket iadesi buradan yapılmaz.** Paket iadesinin borç kalemini Faz 5'in
/// `POST /customer-packages/:id/refund` akışı üretiyor ve müşteri kartındaki
/// ``PackageRefundSheet`` orayı çağırıyor; iki ayrı yerden paket iadesi
/// başlatmak, aynı paketin iki kez iade edilmesini denemek demekti.
struct RefundSheet: View {

    let session: AppSession
    /// Verilirse müşteri seçimi atlanır — müşteri kartından açıldığında.
    var customerId: String?

    @Environment(\.dismiss) private var dismiss

    @State private var selectedCustomerId: String?
    @State private var kind: RefundKind = .service
    @State private var amountMinor: Int?
    @State private var method: PaymentMethod = .cash
    @State private var reason = ""
    @State private var error: APIError?
    @State private var isSaving = false
    /// Sheet ömrü boyunca tek anahtar — iade de para hareketi.
    @State private var idempotencyKey = UUID().uuidString

    private var cashStore: CashSessionStore { session.cashSessionStore }
    private var customerStore: CustomerStore { session.customerStore }
    private var service: any FinanceService { session.services.finance }

    private var openCashSession: CashSession? {
        cashStore.openSession(in: session.selectedBranchId)
    }

    private var resolvedCustomerId: String? { customerId ?? selectedCustomerId }

    private var isCashBlocked: Bool {
        method.requiresCashSession && openCashSession == nil
    }

    private var canSubmit: Bool {
        guard resolvedCustomerId != nil else { return false }
        guard let amountMinor, amountMinor > 0 else { return false }
        guard !isCashBlocked, !isSaving else { return false }
        return reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 5
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    if customerId == nil { customerPicker }
                    kindCard
                    amountCard
                    methodCard
                    reasonCard
                    submitButton
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("İade")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task {
                await cashStore.loadIfNeeded()
                await customerStore.load()
            }
            .overlay {
                if isSaving { AuthLoadingOverlay(message: "İade kaydediliyor…") }
            }
        }
        .tint(KlinaraColor.sage)
    }

    private var customerPicker: some View {
        KlinaraSearchablePicker(
            title: "Müşteri",
            options: customerStore.customers,
            label: \.fullName,
            detail: { $0.phone },
            isSelected: { $0.id == selectedCustomerId },
            onSelect: { selectedCustomerId = $0.id },
            searchPrompt: "Müşteri ara",
            emptyMessage: "Aramanızla eşleşen müşteri yok."
        )
    }

    /// `package` kasıtlı olarak listede YOK: paket iadesi kendi akışında.
    private var kindCard: some View {
        KlinaraCard(
            title: "İade türü",
            footnote: "Paket iadesi müşteri kartındaki paket detayından yapılır."
        ) {
            KlinaraSegmentedPicker(
                options: [RefundKind.service, .other],
                selection: $kind,
                title: { $0.turkishName }
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private var amountCard: some View {
        KlinaraCard(title: "Tutar", footnote: "İade tutarı pozitif girilir; yön iade türüyle bellidir.") {
            KlinaraMoneyField(
                label: "İade edilen",
                amountMinor: $amountMinor,
                error: error?.fieldErrors["amountMinor"]
            )
            .padding(KlinaraMetrics.md)
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
        guard method.requiresCashSession else { return "Nakit dışı iadeler kasaya işlenmez." }
        return openCashSession == nil
            ? "Nakit iade için açık bir kasa gerekir."
            : "İade çekmeceden çıkış olarak kasaya yazılacak."
    }

    private var reasonCard: some View {
        KlinaraCard(title: "Gerekçe") {
            KlinaraTextEditor(
                label: "İade gerekçesi",
                text: $reason,
                placeholder: "En az 5 karakter",
                error: error?.fieldErrors["reason"],
                minHeight: 90
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private var submitButton: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            KlinaraButton(
                title: "İadeyi kaydet",
                kind: .primary,
                icon: "arrow.uturn.backward",
                isLoading: isSaving,
                isEnabled: canSubmit
            ) {
                Task { await submit() }
            }

            if isCashBlocked {
                Text("Nakit iade için önce kasayı açmalısınız.")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.danger)
            }
        }
    }

    private func submit() async {
        guard let resolvedCustomerId, let amountMinor else { return }
        error = nil
        isSaving = true
        defer { isSaving = false }
        do {
            _ = try await service.createRefund(
                CreateRefundInput(
                    customerId: resolvedCustomerId,
                    kind: kind,
                    amountMinor: amountMinor,
                    method: method,
                    chargeId: nil,
                    customerPackageId: nil,
                    cashSessionId: method.requiresCashSession ? openCashSession?.id : nil,
                    reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)
                ),
                idempotencyKey: idempotencyKey
            )
            if let sessionId = openCashSession?.id {
                await cashStore.refreshSummaryIfLoaded(sessionId: sessionId)
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
