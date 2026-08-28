import SwiftUI

/// Gelen kutusu — müşterilerin WhatsApp'tan yazdığı serbest metinler.
///
/// Buton yanıtları (Onayla / İptal Et) buraya **düşmez**: sunucu onları
/// doğrudan randevu durumuna çeviriyor (Ek M). Burada duran, bir insanın
/// okuyup cevaplaması gereken mesajdır — ve uygulamadan cevap yazılamaz,
/// çünkü sunucuda giden serbest metin ucu yok. Ekran bunu saklamaz.
struct InboxView: View {

    let session: AppSession

    @State private var store: InboxStore?
    @State private var error: APIError?

    private var canHandle: Bool { session.can(Permissions.notificationSend) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    filterPicker(store)
                    if let error {
                        ErrorBanner(error: error, onRetry: nil)
                    }
                    content(store)
                } else {
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Gelen kutusu")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store?.load() }
        .task {
            guard store == nil else { return }
            let created = InboxStore(service: session.services.whatsapp)
            store = created
            await created.load()
        }
    }

    private func filterPicker(_ store: InboxStore) -> some View {
        KlinaraSegmentedPicker(
            options: InboxFilter.allCases,
            selection: Binding(
                get: { store.onlyUnhandled ? .unhandled : .all },
                set: { value in
                    Task { await store.setOnlyUnhandled(value == .unhandled) }
                }
            ),
            title: \.turkishName
        )
    }

    @ViewBuilder
    private func content(_ store: InboxStore) -> some View {
        switch store.state {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(.vertical, KlinaraMetrics.xl)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.load() } })

        case .loaded(let items):
            if items.isEmpty {
                EmptyStateView(
                    icon: "tray",
                    title: store.onlyUnhandled ? "Bekleyen mesaj yok" : "Gelen mesaj yok",
                    message: store.onlyUnhandled
                        ? "İşlenmemiş bir mesaj kalmadı."
                        : "Müşteriler WhatsApp'tan yazdığında mesajlar burada görünür."
                )
            } else {
                KlinaraCard(
                    title: "Mesajlar",
                    // Sunucu bu uçta cursor VERMİYOR (yalnız `limit`); "daha
                    // fazlası var" izlenimi vermemek için sınırı söylüyoruz.
                    footnote: "En yeni mesajlar gösterilir. Uygulamadan yanıt yazılamaz; müşteriye WhatsApp'tan dönün."
                ) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { KlinaraDivider() }
                        row(item, store: store)
                    }
                }
            }
        }
    }

    private func row(_ item: InboxItem, store: InboxStore) -> some View {
        // Numara, rozet ve saat TEK satıra sığmıyor: maskeli numara ile
        // "Kayıtlı müşteri değil" rozeti yan yana kartı taşırıyor. Saat kendi
        // satırında; sıkıştırmak numaranın kısalmasıyla biterdi ve numara
        // satırın en çok işe yarayan parçası.
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            HStack(spacing: KlinaraMetrics.sm) {
                Text(item.from)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .lineLimit(1)

                if item.customerId == nil {
                    // Sunucu tanınmayan numarayı bilerek eşleştirmiyor: yanlış
                    // müşteriye bağlamak yanlış kartı açardı.
                    KlinaraBadge(text: "Kayıtlı müşteri değil", tone: .muted)
                }
                if item.isHandled {
                    KlinaraBadge(text: "İşlendi", tone: .positive, icon: "checkmark")
                }
                if item.messageType != "text" {
                    KlinaraBadge(text: item.messageTypeLabel, tone: .neutral)
                }

                Spacer(minLength: 0)
            }

            Text(session.clock.formatDateTime(item.receivedAt))
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            Text(item.preview)
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoal)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: KlinaraMetrics.lg) {
                if let customerId = item.customerId {
                    NavigationLink {
                        CustomerDetailView(session: session, customerId: customerId)
                    } label: {
                        Text("Müşteri kartı")
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }
                }

                if canHandle, !item.isHandled {
                    Button("İşlendi olarak işaretle") {
                        Task { await markHandled(item.id, store: store) }
                    }
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.sageDeep)
                    .disabled(store.isSaving)
                }

                Spacer(minLength: 0)
            }
        }
        // ``KlinaraCard`` içeriğine yatay boşluk EKLEMEZ; satırlar kendi
        // dolgusunu taşır (``KlinaraRow`` ile aynı `md` değeri). Unutulduğunda
        // metin kartın kenarına yapışır.
        .padding(KlinaraMetrics.md)
    }

    private func markHandled(_ id: String, store: InboxStore) async {
        error = nil
        do {
            try await store.markHandled(id: id)
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}

/// Gelen kutusunun tek süzgeci. Ayrı bir tip, `Bool` yerine: segmented
/// picker `Identifiable` istiyor ve `true`/`false` etiketleri okunmaz olurdu.
private enum InboxFilter: String, CaseIterable, Identifiable {
    case unhandled
    case all

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .unhandled: return "İşlenmemiş"
        case .all: return "Tümü"
        }
    }
}
