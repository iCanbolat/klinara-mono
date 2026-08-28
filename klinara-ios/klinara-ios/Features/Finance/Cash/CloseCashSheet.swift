import SwiftUI

/// Kasa kapanışı: sayılan tutar → fark → gerekçe.
///
/// **Fark kapatmadan ÖNCE ekranda hesaplanıyor.** Sunucu da farkta gerekçe
/// zorunlu tutuyor ve gerekçesiz kapanışı `422` ile reddediyor; kullanıcıya
/// sayımı girdikten sonra hata göstermek yerine, farkı anında gösterip gerekçe
/// alanını açmak aynı kuralı anlaşılır kılıyor.
struct CloseCashSheet: View {

    let session: AppSession
    let summary: CashSessionSummary

    @Environment(\.dismiss) private var dismiss

    @State private var countedMinor: Int?
    @State private var differenceReason = ""
    @State private var error: APIError?

    private var store: CashSessionStore { session.cashSessionStore }

    private var difference: Int? {
        countedMinor.map { summary.difference(counted: $0) }
    }

    private var hasDifference: Bool { (difference ?? 0) != 0 }

    private var canSubmit: Bool {
        guard countedMinor != nil, !store.isSaving else { return false }
        if hasDifference {
            return differenceReason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 5
        }
        return true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    expectedCard
                    countCard
                    if hasDifference { differenceCard }
                    submitButton
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Kasayı kapat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .overlay {
                if store.isSaving { AuthLoadingOverlay(message: "Kasa kapatılıyor…") }
            }
        }
        .tint(KlinaraColor.sage)
    }

    private var expectedCard: some View {
        KlinaraCard(
            title: "Beklenen",
            footnote: "Açılış bakiyesi + nakit hareketler. Kart ve havale bu tutara girmez."
        ) {
            KlinaraRow(
                label: "Çekmecede olması gereken",
                value: Money.format(minor: summary.expectedMinor, currency: summary.session.currency),
                isMonospaced: true
            )
            KlinaraDivider()
            KlinaraRow(
                label: "Açılış bakiyesi",
                value: Money.format(
                    minor: summary.session.openingBalanceMinor,
                    currency: summary.session.currency
                ),
                isMonospaced: true
            )
        }
    }

    private var countCard: some View {
        KlinaraCard(title: "Sayım") {
            KlinaraMoneyField(
                label: "Sayılan nakit",
                amountMinor: $countedMinor,
                error: error?.fieldErrors["countedMinor"]
            )
            .padding(KlinaraMetrics.md)

            if let difference {
                KlinaraDivider()
                KlinaraRow(
                    label: differenceLabel(difference),
                    value: Money.format(minor: abs(difference), currency: summary.session.currency),
                    isMonospaced: true
                )
            }
        }
    }

    private func differenceLabel(_ difference: Int) -> String {
        switch difference {
        case 0: "Sayım tutuyor"
        case ..<0: "Eksik"
        default: "Fazla"
        }
    }

    private var differenceCard: some View {
        KlinaraCard(
            title: "Fark gerekçesi",
            footnote: "Sayım tutmadığında gerekçe zorunludur; kayıt denetim izine yazılır."
        ) {
            KlinaraTextEditor(
                label: "Gerekçe",
                text: $differenceReason,
                placeholder: "En az 5 karakter",
                error: error?.fieldErrors["differenceReason"],
                minHeight: 90
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private var submitButton: some View {
        KlinaraButton(
            title: "Kasayı kapat",
            kind: .primary,
            icon: "tray.and.arrow.up",
            isLoading: store.isSaving,
            isEnabled: canSubmit
        ) {
            Task { await close() }
        }
    }

    private func close() async {
        guard let countedMinor else { return }
        error = nil
        let trimmed = differenceReason.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await store.close(
                sessionId: summary.session.id,
                version: summary.session.version,
                countedMinor: countedMinor,
                differenceReason: hasDifference ? trimmed : nil
            )
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
