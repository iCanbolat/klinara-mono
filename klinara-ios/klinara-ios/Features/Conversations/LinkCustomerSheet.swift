import SwiftUI

/// Kayıtlı olmayan numaradan gelen sohbeti bir müşteriye bağlar.
///
/// Sohbeti açmayı engellemez: bağlamadan da yazışılabilir. Bağlandığında
/// geçmiş gelen mesajlar da müşteriye bağlanır (sunucu).
struct LinkCustomerSheet: View {

    let session: AppSession
    let store: ConversationThreadStore

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var results: LoadState<[Customer]>?
    @State private var searchTask: Task<Void, Never>?
    @State private var linkingId: String?
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error { ErrorBanner(error: error) }
                    resultsCard
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(KlinaraColor.surface)
            .navigationTitle("Müşteriye bağla")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Ad ya da telefon")
            .onChange(of: searchText) { _, term in search(term) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                }
            }
        }
        .tint(KlinaraColor.sage)
    }

    @ViewBuilder
    private var resultsCard: some View {
        switch results {
        case nil:
            KlinaraCard {
                KlinaraRow(label: "Müşteriyi arayın", detail: "Ad ya da telefonun en az iki karakteri.")
            }
        case .loading:
            KlinaraSkeletonBody(style: .rowsShort)
        case .failed(let failure):
            ErrorBanner(error: failure)
        case .loaded(let found):
            KlinaraCard {
                if found.isEmpty {
                    KlinaraRow(label: "Eşleşen müşteri yok")
                } else {
                    ForEach(Array(found.enumerated()), id: \.element.id) { index, customer in
                        if index > 0 { KlinaraDivider() }
                        Button {
                            Task { await link(customer) }
                        } label: {
                            KlinaraRow(
                                label: customer.fullName,
                                detail: customer.phone.map(PhoneNumberField.pretty)
                            ) {
                                if linkingId == customer.id {
                                    ProgressView()
                                } else {
                                    Image(systemName: "link")
                                        .foregroundStyle(KlinaraColor.sageDeep)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(linkingId != nil)
                    }
                }
            }
        }
    }

    private func search(_ term: String) {
        searchTask?.cancel()
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            results = nil
            return
        }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            results = .loading
            do {
                let found = try await session.services.customers.search(trimmed, limit: 20)
                guard !Task.isCancelled else { return }
                results = .loaded(found)
            } catch {
                guard !Task.isCancelled else { return }
                results = .failed(error as? APIError ?? .network)
            }
        }
    }

    private func link(_ customer: Customer) async {
        linkingId = customer.id
        error = nil
        defer { linkingId = nil }
        do {
            try await store.linkCustomer(customer.id)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
