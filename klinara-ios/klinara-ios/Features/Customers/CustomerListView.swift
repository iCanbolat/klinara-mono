import SwiftUI

/// "Müşteriler" sekmesinin kökü.
///
/// Sunucu bu listeyi **sayfalamıyor ve arama parametresi almıyor**; arama bu
/// yüzden istemcide. Batch 4.1 `GET /customers/search` getirdiğinde değişecek
/// tek yer ``CustomerStore/search(_:)``, bu ekran değil.
struct CustomerListView: View {

    let session: AppSession

    @State private var searchText = ""
    @State private var editing: CustomerEditorView.Target?

    private var store: CustomerStore { session.customerStore }
    private var canWrite: Bool { session.can(Permissions.customerWrite) }

    var body: some View {
        NavigationStack {
            KlinaraScreen(
                state: store.state,
                emptyCheck: \.isEmpty,
                emptyTitle: "Müşteri yok",
                emptyMessage: canWrite
                    ? "Sağ üstteki artı ile ilk müşteriyi ekleyin."
                    : "Henüz müşteri kaydı oluşturulmamış.",
                emptyIcon: "person.2",
                onRetry: { await store.reload() }
            ) { _ in
                let visible = store.search(searchText)
                if visible.isEmpty {
                    Text("Aramanızla eşleşen müşteri yok.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, KlinaraMetrics.lg)
                } else {
                    KlinaraCard {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, customer in
                            if index > 0 { KlinaraDivider() }
                            KlinaraNavigationRow(
                                label: customer.fullName,
                                detail: customer.phone.map(PhoneNumberField.pretty) ?? customer.email
                            ) {
                                CustomerDetailView(session: session, customerId: customer.id)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Müşteriler")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Ad, telefon veya e-posta")
            .toolbar {
                if canWrite {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { editing = .create } label: { Image(systemName: "plus") }
                            .accessibilityLabel("Yeni müşteri")
                    }
                }
            }
            .task { await store.load() }
            .refreshable { await store.reload() }
            .sheet(item: $editing) { target in
                CustomerEditorView(session: session, target: target)
            }
        }
        .tint(KlinaraColor.sage)
    }
}
