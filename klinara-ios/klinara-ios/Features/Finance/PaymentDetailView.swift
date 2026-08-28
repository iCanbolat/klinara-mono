import SwiftUI

/// Tahsilat detayı: makbuz numarası, dağıtım ve iptal.
///
/// **Tahsis satırları iptalde silinmez.** Bakiye geri gelir ama makbuzun neyi
/// kapattığı kayıtta kalır; silmek "bu para neye gitmişti?" sorusunu
/// cevapsız bırakırdı.
struct PaymentDetailView: View {

    let session: AppSession
    let store: CustomerAccountStore
    let paymentId: String

    @State private var isVoiding = false

    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.financePaymentWrite) }

    private var payment: Payment? {
        store.payments.first { $0.id == paymentId }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let payment {
                    summaryCard(payment)
                    allocationsCard(payment)
                    if payment.status == .void {
                        voidCard(payment)
                    } else if canWrite {
                        voidButton
                    }
                } else {
                    EmptyStateView(
                        icon: "banknote",
                        title: "Tahsilat bulunamadı",
                        message: "Kayıt güncellenmiş olabilir."
                    )
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle(payment.map { "Makbuz #\($0.receiptNo)" } ?? "Tahsilat")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isVoiding) {
            if let payment {
                ReasonSheet(
                    title: "Tahsilatı iptal et",
                    message: "İptal bakiyeyi geri getirir; tahsis kayıtları silinmez.",
                    actionTitle: "Tahsilatı iptal et",
                    isSaving: store.isSaving
                ) { reason in
                    try await store.voidPayment(
                        id: payment.id,
                        version: payment.version,
                        reason: reason
                    )
                }
            }
        }
    }

    private func summaryCard(_ payment: Payment) -> some View {
        KlinaraCard(title: "Tahsilat", footnote: receiptFootnote) {
            KlinaraRow(
                label: "Tutar",
                value: Money.format(minor: payment.amountMinor, currency: payment.currency),
                isMonospaced: true
            )
            KlinaraDivider()
            KlinaraRow(label: "Yöntem", value: payment.method.turkishName)
            KlinaraDivider()
            KlinaraRow(label: "Tarih", value: clock.formatDateTime(payment.paidAt))
            KlinaraDivider()
            KlinaraRow(
                label: "Durum",
                value: payment.status.turkishName
            )
            if payment.hasAdvance {
                KlinaraDivider()
                KlinaraRow(
                    label: "Avans olarak kalan",
                    value: Money.format(minor: payment.unallocatedMinor, currency: payment.currency),
                    detail: "Sonraki kalemlere tahsis edilebilir.",
                    isMonospaced: true
                )
            }
            if let note = payment.note, !note.isEmpty {
                KlinaraDivider()
                KlinaraRow(label: "Not", detail: note)
            }
        }
    }

    private var receiptFootnote: String {
        "Makbuz numaraları kiracı bazında boşluksuz artar."
    }

    private func allocationsCard(_ payment: Payment) -> some View {
        KlinaraCard(
            title: "Dağıtım",
            footnote: payment.allocations.isEmpty
                ? "Bu tahsilat hiçbir kaleme dağıtılmadı; tamamı avans."
                : nil
        ) {
            if payment.allocations.isEmpty {
                KlinaraRow(label: "Dağıtım yok")
            } else {
                ForEach(Array(payment.allocations.enumerated()), id: \.element.id) { index, line in
                    if index > 0 { KlinaraDivider() }
                    KlinaraRow(
                        label: line.chargeDescription,
                        value: Money.format(minor: line.amountMinor, currency: payment.currency),
                        isMonospaced: true
                    )
                }
            }
        }
    }

    private func voidCard(_ payment: Payment) -> some View {
        KlinaraCard(title: "İptal") {
            KlinaraRow(
                label: "İptal tarihi",
                value: payment.voidedAt.map(clock.formatDateTime) ?? "—"
            )
            if let reason = payment.voidedReason {
                KlinaraDivider()
                KlinaraRow(label: "Gerekçe", detail: reason)
            }
        }
    }

    private var voidButton: some View {
        KlinaraButton(
            title: "Tahsilatı iptal et",
            kind: .tertiary,
            icon: "arrow.uturn.backward",
            isEnabled: !store.isSaving
        ) {
            isVoiding = true
        }
    }
}

/// Gerekçe isteyen tek alanlık onay sheet'i.
///
/// İptal, void ve iade akışlarının üçü de aynı şeyi soruyor: "neden?" Üç ayrı
/// sheet yazmak, gerekçe uzunluğu kuralının bir yerde unutulması demekti.
struct ReasonSheet: View {

    let title: String
    var message: String?
    let actionTitle: String
    var isSaving: Bool
    /// Gerekçeyi alıp işi yapan kapanış. Hata fırlatırsa sheet kapanmaz ve
    /// hata banner'da görünür — kullanıcı düzeltip tekrar deneyebilsin.
    let perform: (String) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var reason = ""
    @State private var error: APIError?

    /// Sunucu gerekçelerde en az 5 karakter istiyor; kuralı istemcide de
    /// uygulamak kullanıcıyı 422'ye göndermekten iyi.
    private var isValid: Bool {
        reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 5
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    KlinaraCard(title: "Gerekçe", footnote: message) {
                        KlinaraTextEditor(
                            label: "Gerekçe",
                            text: $reason,
                            placeholder: "En az 5 karakter",
                            error: error?.fieldErrors["reason"],
                            minHeight: 100
                        )
                        .padding(KlinaraMetrics.md)
                    }

                    KlinaraButton(
                        title: actionTitle,
                        kind: .tertiary,
                        isLoading: isSaving,
                        isEnabled: isValid && !isSaving
                    ) {
                        Task { await run() }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
        }
        .tint(KlinaraColor.sage)
    }

    private func run() async {
        error = nil
        do {
            try await perform(reason.trimmingCharacters(in: .whitespacesAndNewlines))
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
