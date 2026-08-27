import SwiftUI

/// "Müşteriler" sekmesinin kökü.
///
/// İki okuma yolu var ve ekran ikisini de gösteriyor ama **karıştırmıyor**:
/// gezinme cursor sayfalamalı `GET /customers`, arama `GET /customers/search`.
/// Aramayı yüklü sayfa üzerinde yerel filtreye bırakmak, kullanıcının hiç
/// görmediği kayıtları aramamak demekti. Hangisinin etkin olduğunu
/// ``CustomerStore/visible`` söylüyor.
struct CustomerListView: View {

    let session: AppSession

    @State private var searchText = ""
    @State private var editing: CustomerEditorView.Target?

    private var store: CustomerStore { session.customerStore }
    private var canWrite: Bool { session.can(Permissions.customerWrite) }
    private var isSearching: Bool { store.searchState != nil }

    var body: some View {
        NavigationStack {
            KlinaraScreen(
                state: store.visible,
                emptyCheck: \.isEmpty,
                emptyTitle: isSearching ? "Eşleşen müşteri yok" : "Müşteri yok",
                emptyMessage: isSearching
                    ? "Ad ya da telefon numarasının bir bölümünü yazmayı deneyin."
                    : (canWrite
                        ? "Sağ üstteki artı ile ilk müşteriyi ekleyin."
                        : "Henüz müşteri kaydı oluşturulmamış."),
                emptyIcon: isSearching ? "magnifyingglass" : "person.2",
                onRetry: {
                    if isSearching {
                        store.retrySearch()
                    } else {
                        await store.reload()
                    }
                }
            ) { visible in
                KlinaraCard {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, customer in
                        if index > 0 { KlinaraDivider() }
                        KlinaraNavigationRow(
                            label: customer.fullName,
                            detail: detail(for: customer)
                        ) {
                            CustomerDetailView(session: session, customerId: customer.id)
                        }
                        if !customer.tags.isEmpty {
                            CustomerTagRow(tags: customer.tags)
                        }
                    }
                }

                if store.canLoadMore {
                    loadMoreTrigger
                }
            }
            .navigationTitle("Müşteriler")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Ad veya telefon")
            .onChange(of: searchText) { _, term in store.updateSearch(term) }
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

    private func detail(for customer: Customer) -> String? {
        customer.phone.map(PhoneNumberField.pretty) ?? customer.email
    }

    /// Listenin sonuna gelindiğinde sonraki sayfayı ister. `.onAppear` birden
    /// çok kez tetiklenebilir; ``CustomerStore/loadMore()`` süren isteği kendi
    /// eliyor.
    private var loadMoreTrigger: some View {
        HStack {
            Spacer()
            ProgressView()
                .tint(KlinaraColor.sage)
            Spacer()
        }
        .padding(.vertical, KlinaraMetrics.md)
        .onAppear { Task { await store.loadMore() } }
    }
}

/// Satır altındaki etiket rozetleri.
///
/// ``KlinaraBadge`` sabit bir ton kümesi taşıyor; etiket rengi kullanıcı
/// tarafından seçiliyor, bu yüzden ayrı bir çizim.
struct CustomerTagRow: View {

    let tags: [CustomerTag]

    var body: some View {
        FlowLayout(spacing: KlinaraMetrics.xs) {
            ForEach(tags) { tag in
                CustomerTagChip(tag: tag)
            }
        }
        .padding(.horizontal, KlinaraMetrics.md)
        .padding(.bottom, KlinaraMetrics.sm)
    }
}

struct CustomerTagChip: View {

    let tag: CustomerTag

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(CustomerTagChip.color(tag.color))
                .frame(width: 7, height: 7)
            Text(tag.name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(KlinaraColor.charcoal)
        }
        .padding(.horizontal, KlinaraMetrics.sm)
        .padding(.vertical, 3)
        .background(KlinaraColor.border.opacity(0.35))
        .clipShape(.capsule)
        .accessibilityLabel("Etiket: \(tag.name)")
    }

    /// `#RRGGBB` → `Color`. Sunucu biçimi doğruluyor ama bozuk bir değer
    /// geldiğinde çizim patlamamalı; nötr bir tona düşer.
    static func color(_ hex: String?) -> Color {
        guard let hex, hex.hasPrefix("#"), hex.count == 7,
              let value = Int(hex.dropFirst(), radix: 16)
        else { return KlinaraColor.charcoalMuted }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
