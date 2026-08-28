import SwiftUI

/// Mesaj günlüğü — "gitti mi, gitmediyse neden?"
///
/// `skipped` satırları **gizlenmez**. Ek M kararı: engellenen mesaj atılmıyor,
/// `skipped` yazılıyor; "gitmedi mi, hiç denendi mi?" sorusu cevaplanabilir
/// kalmalı. Bu ekran o cevabın durduğu yer, süzülüp temiz görünen bir liste
/// değil.
///
/// ``customerId`` verilirse liste tek bir müşteriye kilitlenir — müşteri
/// kartından açılan görünüm.
struct MessageLogView: View {

    let session: AppSession
    var customerId: String?

    @State private var store: MessageLogStore?
    @State private var statusFilter: MessageStatusFilter = .all
    @State private var channelFilter: MessageChannelFilter = .all
    @State private var eventFilter: NotificationEvent?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    filters(store)
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
        .navigationTitle(customerId == nil ? "Mesaj günlüğü" : "Gönderilen mesajlar")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store?.load() }
        .task {
            guard store == nil else { return }
            let created = MessageLogStore(
                service: session.services.messages,
                filter: customerId.map(MessageFilter.customer) ?? .none
            )
            store = created
            await created.load()
        }
    }

    private func filters(_ store: MessageLogStore) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            KlinaraSegmentedPicker(
                options: MessageStatusFilter.allCases,
                selection: Binding(
                    get: { statusFilter },
                    set: { value in
                        statusFilter = value
                        Task { await apply(store) }
                    }
                ),
                title: \.turkishName
            )

            KlinaraSegmentedPicker(
                options: MessageChannelFilter.allCases,
                selection: Binding(
                    get: { channelFilter },
                    set: { value in
                        channelFilter = value
                        Task { await apply(store) }
                    }
                ),
                title: \.turkishName
            )

            // Dokuz olay ``KlinaraChipGrid``te beş satır kaplıyor ve listeyi
            // ekranın dışına itiyordu. Yatay kaydırma, süzgecin listeden daha
            // fazla yer tutmasını engelliyor.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: KlinaraMetrics.sm) {
                    ForEach(NotificationEvent.selectable) { event in
                        eventChip(event, store: store)
                    }
                }
                .padding(.horizontal, 2)
                .padding(.vertical, 2)
            }
        }
    }

    private func eventChip(_ event: NotificationEvent, store: MessageLogStore) -> some View {
        let isSelected = event == eventFilter
        return Button {
            eventFilter = isSelected ? nil : event
            Task { await apply(store) }
        } label: {
            Text(event.turkishName)
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(isSelected ? KlinaraColor.sageDeep : KlinaraColor.charcoal)
                .padding(.horizontal, KlinaraMetrics.md)
                .padding(.vertical, KlinaraMetrics.sm)
                .background(isSelected ? KlinaraColor.sageSoft : KlinaraColor.surfaceRaised)
                .overlay(
                    Capsule().stroke(
                        isSelected ? KlinaraColor.sage : KlinaraColor.border,
                        lineWidth: KlinaraMetrics.borderWidth
                    )
                )
                .clipShape(.capsule)
        }
        .buttonStyle(.plain)
    }

    private func apply(_ store: MessageLogStore) async {
        var filter = MessageFilter(customerId: customerId)
        filter.status = statusFilter.value
        filter.channel = channelFilter.value
        filter.event = eventFilter
        await store.applyFilter(filter)
    }

    @ViewBuilder
    private func content(_ store: MessageLogStore) -> some View {
        switch store.state {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(.vertical, KlinaraMetrics.xl)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.load() } })

        case .loaded(let messages):
            if messages.isEmpty {
                EmptyStateView(
                    icon: "bubble.left.and.text.bubble.right",
                    title: "Mesaj yok",
                    message: store.filter.isActive
                        ? "Seçtiğiniz süzgeçlere uyan mesaj bulunamadı."
                        : "Henüz hiçbir bildirim üretilmedi."
                )
            } else {
                KlinaraCard(
                    title: "Mesajlar",
                    footnote: "Numaralar maskeli tutulur; ham adres kaydedilmez."
                ) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if index > 0 { KlinaraDivider() }
                        NavigationLink {
                            MessageDetailView(session: session, message: message)
                        } label: {
                            row(message)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if store.cursor != nil {
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.md)
                        .onAppear { Task { await store.loadMore() } }
                }
            }
        }
    }

    private func row(_ message: Message) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.sm) {
                Text(message.event.turkishName)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                KlinaraBadge(text: message.status.turkishName, tone: message.status.badgeTone)
            }

            Text("\(message.channel.turkishName) · \(message.to)")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            Text(session.clock.formatDateTime(message.createdAt))
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)
    }
}

// MARK: - Süzgeç tipleri
//
// `MessageStatus?` ve `NotificationChannel?` doğrudan segmented picker'a
// verilemiyor (`Identifiable` ve `Hashable` opsiyonelde kaybolur) ve "Tümü"
// seçeneğinin bir kimliği olmalı. İki küçük sarmalayıcı, `Optional`ı ekrana
// sızdırmaktan okunaklı.

private enum MessageStatusFilter: String, CaseIterable, Identifiable {
    case all
    case failed
    case skipped
    case delivered

    var id: String { rawValue }

    var value: MessageStatus? {
        switch self {
        case .all: return nil
        case .failed: return .failed
        case .skipped: return .skipped
        case .delivered: return .delivered
        }
    }

    var turkishName: String {
        switch self {
        case .all: return "Tümü"
        case .failed: return "Başarısız"
        // Segmented picker'da dört seçenek var; "Gönderilmedi" kesiliyordu.
        // Kısaltma ``MessageStatus/skipped``ın anlamını değiştirmiyor,
        // açıklaması mesaj detayında duruyor.
        case .skipped: return "Atlandı"
        case .delivered: return "Ulaştı"
        }
    }
}

private enum MessageChannelFilter: String, CaseIterable, Identifiable {
    case all
    case whatsapp
    case email

    var id: String { rawValue }

    /// Yalnız gerçekten gönderim yapan kanallar süzgeçte: SMS ve push kanal
    /// soyutlamasında var ama sağlayıcısı yok (Ek M), boş bir liste üretirlerdi.
    var value: NotificationChannel? {
        switch self {
        case .all: return nil
        case .whatsapp: return .whatsapp
        case .email: return .email
        }
    }

    var turkishName: String {
        switch self {
        case .all: return "Tüm kanallar"
        case .whatsapp: return "WhatsApp"
        case .email: return "E-posta"
        }
    }
}
