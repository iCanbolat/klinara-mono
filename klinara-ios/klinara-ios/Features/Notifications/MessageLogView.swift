import SwiftUI

/// Mesaj günlüğü — "gitti mi, gitmediyse neden?"
///
/// `skipped` satırları **gizlenmez**. Ek M kararı: engellenen mesaj atılmıyor,
/// `skipped` yazılıyor; "gitmedi mi, hiç denendi mi?" sorusu cevaplanabilir
/// kalmalı. Bu ekran o cevabın durduğu yer, süzülüp temiz görünen bir liste
/// değil.
///
/// **Kanal süzgeci yok.** Klinik müşterisiyle yalnız WhatsApp üzerinden
/// yazışıyor; tek seçenekli bir süzgeç, listeden fazla yer tutan bir yanıltma
/// olurdu. Satır yine kanal adını taşır — geçmişteki e-posta kayıtları okunur
/// kalsın.
///
/// ``customerId`` verilirse liste tek bir müşteriye kilitlenir — müşteri
/// kartından açılan görünüm.
struct MessageLogView: View {

    let session: AppSession
    var customerId: String?

    @State private var store: MessageLogStore?
    @State private var statusFilter: MessageStatusFilter = .all
    @State private var eventFilter: NotificationEvent?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: KlinaraMetrics.lg, pinnedViews: [.sectionHeaders]) {
                if let store {
                    filters(store)
                    content(store)
                } else {
                    KlinaraSkeletonBody(style: .cardsLong)
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
                clock: session.clock,
                filter: customerId.map(MessageFilter.customer) ?? .none
            )
            store = created
            await created.load()
        }
    }

    // MARK: Süzgeçler

    /// İki segment seçici üst üste yığılınca listeyi ekranın dışına itiyordu.
    /// Durum da olay da artık aynı dili konuşan yatay çip satırları.
    private func filters(_ store: MessageLogStore) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            pillRow {
                ForEach(MessageStatusFilter.allCases) { option in
                    KlinaraFilterPill(
                        title: option.turkishName,
                        isSelected: option == statusFilter
                    ) {
                        statusFilter = option
                        Task { await apply(store) }
                    }
                }
            }

            pillRow {
                ForEach(NotificationEvent.selectable) { event in
                    KlinaraFilterPill(
                        title: event.turkishName,
                        isSelected: event == eventFilter
                    ) {
                        eventFilter = eventFilter == event ? nil : event
                        Task { await apply(store) }
                    }
                }
            }

            if store.filter.hasUserFilters {
                Button {
                    Task { await clearFilters(store) }
                } label: {
                    Label("Süzgeçleri temizle", systemImage: "xmark.circle.fill")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(KlinaraColor.sageDeep)
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
        }
    }

    private func pillRow<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KlinaraMetrics.sm) {
                content()
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
    }

    // MARK: Özet

    /// Üç sayaç. **Kapsamı yüklenmiş sayfalardır** ve dipnot bunu söyler:
    /// sunucuda sayaç ucu yok, uydurulmuş bir toplam göstermektense neyin
    /// sayıldığını söylemek.
    private func summaryStrip(_ store: MessageLogStore) -> some View {
        let summary = store.summary
        return VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(spacing: KlinaraMetrics.sm) {
                summaryTile(
                    label: "Toplam",
                    value: summary.total,
                    tone: .neutral,
                    isSelected: statusFilter == .all
                ) {
                    Task { await clearFilters(store) }
                }

                summaryTile(
                    label: "Başarısız",
                    value: summary.failed,
                    tone: .warning,
                    isSelected: statusFilter == .failed
                ) {
                    statusFilter = statusFilter == .failed ? .all : .failed
                    Task { await apply(store) }
                }

                summaryTile(
                    label: "Atlandı",
                    value: summary.skipped,
                    tone: .muted,
                    isSelected: statusFilter == .skipped
                ) {
                    statusFilter = statusFilter == .skipped ? .all : .skipped
                    Task { await apply(store) }
                }
            }

            Text("Yüklenen \(summary.total) kayıt içinde.")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
    }

    private func summaryTile(
        label: String,
        value: Int,
        tone: KlinaraBadge.Tone,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(value)")
                    .klinaraText(.titleM)
                    .monospacedDigit()
                    .foregroundStyle(tone == .warning ? KlinaraColor.danger : KlinaraColor.charcoal)

                Text(label)
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(KlinaraMetrics.md)
            .background(isSelected ? KlinaraColor.sageSoft : KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius, style: .continuous)
                    .stroke(
                        isSelected ? KlinaraColor.sage : KlinaraColor.border,
                        lineWidth: KlinaraMetrics.borderWidth
                    )
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius, style: .continuous))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(value)")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    // MARK: İçerik

    @ViewBuilder
    private func content(_ store: MessageLogStore) -> some View {
        switch store.state {
        case .loading:
            KlinaraSkeletonBody(style: .cardsLong)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.load() } })

        case .loaded(let messages):
            if messages.isEmpty {
                EmptyStateView(
                    icon: "bubble.left.and.text.bubble.right",
                    title: "Mesaj yok",
                    message: store.filter.hasUserFilters
                        ? "Seçtiğiniz süzgeçlere uyan mesaj bulunamadı."
                        : "Henüz hiçbir bildirim üretilmedi.",
                    actionTitle: store.filter.hasUserFilters ? "Süzgeçleri temizle" : nil,
                    actionIcon: "line.3.horizontal.decrease",
                    action: store.filter.hasUserFilters
                        ? { Task { await clearFilters(store) } }
                        : nil
                )
            } else {
                summaryStrip(store)

                // Gün başlığı satır satır tekrar eden tarihin yerini alıyor;
                // satırda yalnız saat kalıyor.
                ForEach(store.groups) { group in
                    Section {
                        KlinaraCard {
                            ForEach(Array(group.messages.enumerated()), id: \.element.id) { index, message in
                                if index > 0 { KlinaraDivider() }
                                NavigationLink {
                                    MessageDetailView(session: session, message: message)
                                } label: {
                                    row(message)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } header: {
                        dayHeader(group.title)
                    }
                }

                Text("Numaralar maskeli tutulur; ham adres kaydedilmez.")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)

                pagination(store)
            }
        }
    }

    private func dayHeader(_ title: String) -> some View {
        Text(title)
            .klinaraText(.label)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, KlinaraMetrics.xs)
            // Yapışkan başlık kaydırılan kartların üstünden geçiyor; zemin
            // olmadan iki metin üst üste okunuyordu.
            .background(KlinaraColor.surface)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private func pagination(_ store: MessageLogStore) -> some View {
        if let error = store.loadMoreError {
            ErrorBanner(error: error, onRetry: { Task { await store.retryLoadMore() } })
        } else if store.cursor != nil {
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(.vertical, KlinaraMetrics.md)
                .onAppear { Task { await store.loadMore() } }
        }
    }

    private func row(_ message: Message) -> some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.md) {
            Image(systemName: message.status.icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(iconTint(message.status))
                .frame(width: 22)
                .padding(.top, 2)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.sm) {
                    Text(message.event.turkishName)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    KlinaraBadge(text: message.status.turkishName, tone: message.status.badgeTone)
                }

                // Gün başlıkta; satırda yalnız saat. Kanal adı duruyor çünkü
                // geçmişte gerçekten e-posta gönderilmiş satırlar var.
                Text("\(session.clock.formatTime(message.createdAt)) · \(message.channel.turkishName) · \(message.to)")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)
    }

    private func iconTint(_ status: MessageStatus) -> Color {
        switch status.badgeTone {
        case .positive: return KlinaraColor.sageDeep
        case .warning: return KlinaraColor.danger
        case .neutral: return KlinaraColor.charcoalMuted
        case .muted: return KlinaraColor.charcoalMuted
        }
    }

    // MARK: Süzgeç uygulama

    private func apply(_ store: MessageLogStore) async {
        var filter = MessageFilter(customerId: customerId)
        filter.status = statusFilter.value
        filter.event = eventFilter
        await store.applyFilter(filter)
    }

    private func clearFilters(_ store: MessageLogStore) async {
        statusFilter = .all
        eventFilter = nil
        await apply(store)
    }
}

// MARK: - Süzgeç tipleri
//
// `MessageStatus?` doğrudan seçiciye verilemiyor (`Identifiable` ve `Hashable`
// opsiyonelde kaybolur) ve "Tümü" seçeneğinin bir kimliği olmalı. Küçük bir
// sarmalayıcı, `Optional`ı ekrana sızdırmaktan okunaklı.

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
        // Kısaltma ``MessageStatus/skipped``ın anlamını değiştirmiyor,
        // açıklaması mesaj detayında duruyor.
        case .skipped: return "Atlandı"
        case .delivered: return "Ulaştı"
        }
    }
}
