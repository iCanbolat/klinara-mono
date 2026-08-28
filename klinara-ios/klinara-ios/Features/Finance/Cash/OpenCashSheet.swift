import SwiftUI

/// Kasa açılışı — çekmecedeki başlangıç nakdi.
///
/// Açılış bakiyesi boş bırakılabilir (sıfır kabul edilir); zorunlu tutmak,
/// çekmecesi boş başlayan kliniği her sabah bir alan doldurmaya zorlardı.
struct OpenCashSheet: View {

    let session: AppSession

    @Environment(\.dismiss) private var dismiss

    @State private var openingBalanceMinor: Int?
    @State private var error: APIError?

    private var store: CashSessionStore { session.cashSessionStore }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    KlinaraCard(
                        title: "Açılış bakiyesi",
                        footnote: "Çekmecede şu an bulunan nakit. Boş bırakılırsa sıfır kabul edilir."
                    ) {
                        KlinaraMoneyField(
                            label: "Açılış nakdi",
                            amountMinor: $openingBalanceMinor,
                            error: error?.fieldErrors["openingBalanceMinor"]
                        )
                        .padding(KlinaraMetrics.md)
                    }

                    KlinaraCard(title: "Şube") {
                        KlinaraRow(
                            label: session.selectedBranch?.name ?? "Şube",
                            detail: "Şube başına yalnız bir kasa açık olabilir."
                        )
                    }

                    KlinaraButton(
                        title: "Kasayı aç",
                        kind: .primary,
                        icon: "tray.and.arrow.down",
                        isLoading: store.isSaving,
                        isEnabled: !store.isSaving
                    ) {
                        Task { await open() }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Kasa aç")
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

    private func open() async {
        error = nil
        do {
            _ = try await store.open(openingBalanceMinor: openingBalanceMinor ?? 0)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
