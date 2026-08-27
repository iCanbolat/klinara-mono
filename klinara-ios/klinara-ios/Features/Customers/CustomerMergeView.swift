import SwiftUI

/// Mükerrer müşteri kaydını bu karta birleştirir.
///
/// Yoldaki kimlik **hayatta kalır**, seçilen kayıt arşivlenir ve tüm randevu,
/// not, dosya ve etiketleri hayatta kalana taşınır. Bu geri alınması pahalı bir
/// işlem: `customer:merge` ayrı bir izin (owner + manager) ve ekran ikinci bir
/// onay istiyor.
///
/// Birleştirme veri **kazanmaktır**: hedefin dolu alanı ezilmez, boş alanı
/// kaynaktan dolar, notlar birleşir.
struct CustomerMergeView: View {

    let session: AppSession
    let target: Customer

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var results: LoadState<[Customer]>?
    @State private var selected: Customer?
    @State private var confirming = false
    @State private var result: CustomerMergeResult?
    @State private var error: APIError?
    @State private var searchTask: Task<Void, Never>?

    private var store: CustomerStore { session.customerStore }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Kayıtları birleştir")
                .navigationBarTitleDisplayMode(.inline)
                .searchable(text: $searchText, prompt: "Mükerrer kaydı ara")
                .onChange(of: searchText) { _, term in search(term) }
                .toolbar { closeButton }
                .confirmationDialog(
                    "Kayıtlar birleştirilsin mi?",
                    isPresented: $confirming,
                    titleVisibility: .visible
                ) {
                    Button("Birleştir", role: .destructive) { Task { await merge() } }
                    Button("Vazgeç", role: .cancel) {}
                } message: {
                    Text(confirmationMessage)
                }
        }
        .tint(KlinaraColor.sage)
    }

    private var content: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    if let result {
                        resultCard(result)
                    } else {
                        targetCard
                        searchResults
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var closeButton: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(result == nil ? "Vazgeç" : "Kapat") { dismiss() }
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
    }

    private var confirmationMessage: String {
        guard let selected else { return "" }
        return "\(selected.fullName) arşivlenecek; tüm randevu, not, dosya ve "
            + "etiketleri \(target.fullName) kartına taşınacak. Bu işlem geri alınamaz."
    }

    private var targetCard: some View {
        KlinaraCard(
            title: "Hayatta kalan kayıt",
            footnote: "Bu kartın dolu alanları korunur; boş alanları diğerinden dolar."
        ) {
            KlinaraRow(
                label: target.fullName,
                detail: target.phone.map(PhoneNumberField.pretty) ?? target.email
            )
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        switch results {
        case nil:
            KlinaraCard(title: "Birleştirilecek kayıt") {
                KlinaraRow(
                    label: "Kaydı aramaya başlayın",
                    detail: "Ad ya da telefon numarasının en az iki karakteri."
                )
            }

        case .loading:
            KlinaraCard(title: "Birleştirilecek kayıt") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let failure):
            ErrorBanner(error: failure, onRetry: {
                let term = searchText
                searchText = ""
                searchText = term
            })

        case .loaded(let found):
            // Hedefin kendisi listeden çıkarılır: bir kayıt kendisiyle
            // birleştirilemez ve sunucu bunu 400 ile reddediyor.
            let candidates = found.filter { $0.id != target.id }
            KlinaraCard(
                title: "Birleştirilecek kayıt",
                footnote: candidates.isEmpty ? nil : "Seçilen kayıt ARŞİVLENİR."
            ) {
                if candidates.isEmpty {
                    KlinaraRow(label: "Eşleşen başka kayıt yok")
                } else {
                    ForEach(Array(candidates.enumerated()), id: \.element.id) { index, customer in
                        if index > 0 { KlinaraDivider() }
                        Button {
                            selected = customer
                            confirming = true
                        } label: {
                            KlinaraRow(
                                label: customer.fullName,
                                detail: customer.phone.map(PhoneNumberField.pretty)
                                    ?? customer.email
                            ) {
                                Image(systemName: "arrow.triangle.merge")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(KlinaraColor.sageDeep)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func resultCard(_ result: CustomerMergeResult) -> some View {
        KlinaraCard(
            title: "Birleştirildi",
            footnote: "Eski kimliğe giden bir bağlantı artık bu karta işaret ediyor."
        ) {
            KlinaraRow(label: "Hayatta kalan", value: result.customer.fullName)
            let summary = result.movedSummary
            if summary.isEmpty {
                KlinaraDivider()
                KlinaraRow(label: "Taşınacak kayıt yoktu")
            } else {
                ForEach(summary, id: \.label) { row in
                    KlinaraDivider()
                    KlinaraRow(label: row.label, value: "\(row.count)")
                }
            }
        }
    }

    /// Aramanın kendi kopyası: ``CustomerStore``'un arama durumu liste ekranına
    /// ait ve bu sheet açıkken onu ezmek, arkadaki listeyi de değiştirirdi.
    private func search(_ term: String) {
        searchTask?.cancel()
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            results = nil
            return
        }
        results = .loading
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            do {
                let found = try await session.services.customers.search(trimmed, limit: nil)
                guard !Task.isCancelled else { return }
                results = .loaded(found)
            } catch let failure as APIError {
                guard !Task.isCancelled else { return }
                if case .cancelled = failure { return }
                results = .failed(failure)
            } catch {
                guard !Task.isCancelled else { return }
                results = .failed(.network)
            }
        }
    }

    private func merge() async {
        guard let selected else { return }
        error = nil
        do {
            result = try await store.merge(into: target.id, sourceId: selected.id)
            results = nil
            searchText = ""
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
