import SwiftUI

/// Sohbetler — müşterilerin WhatsApp'tan yazdıkları ve resepsiyonun cevapları.
///
/// Web'deki Mesajlar ekranının mobil karşılığı: liste burada, akış itilen
/// ekranda (``ConversationThreadView``). Liste ekrana her dönüşte yenilenir —
/// akışta okunan ya da kapatılan sohbet listede eski hâliyle kalmasın.
struct ConversationListView: View {

    let session: AppSession

    @State private var store: ConversationListStore?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    KlinaraSegmentedPicker(
                        options: ConversationFilter.allCases,
                        selection: Binding(
                            get: { store.filter },
                            set: { value in Task { await store.applyFilter(value) } }
                        ),
                        title: \.turkishName
                    )
                    content(store)
                } else {
                    KlinaraSkeletonBody(style: .cardsLong)
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Sohbetler")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store?.load() }
        .task {
            if let store {
                await store.load()
                return
            }
            let created = ConversationListStore(service: session.services.conversations)
            store = created
            await created.load()
        }
    }

    @ViewBuilder
    private func content(_ store: ConversationListStore) -> some View {
        switch store.state {
        case .loading:
            KlinaraSkeletonBody(style: .cardsLong)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.load() } })

        case .loaded(let rows):
            if rows.isEmpty {
                EmptyStateView(
                    icon: "bubble.left.and.bubble.right",
                    title: store.filter == .open ? "Henüz sohbet yok" : "Bu süzgece uyan sohbet yok",
                    message: store.filter == .open
                        ? "Müşteriler WhatsApp'tan yazdığında ya da bir hatırlatmayı yanıtladığında sohbetler burada görünür."
                        : nil
                )
            } else {
                KlinaraCard {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, conversation in
                        if index > 0 { KlinaraDivider() }
                        NavigationLink {
                            ConversationThreadView(
                                session: session,
                                conversationId: conversation.id,
                                onChange: { store.update($0) }
                            )
                        } label: {
                            ConversationRowView(conversation: conversation, clock: session.clock)
                        }
                        .buttonStyle(.plain)
                        .onAppear {
                            if conversation.id == rows.last?.id {
                                Task { await store.loadMore() }
                            }
                        }
                    }
                }
                loadMoreFooter(store)
            }
        }
    }

    @ViewBuilder
    private func loadMoreFooter(_ store: ConversationListStore) -> some View {
        if let error = store.loadMoreError {
            ErrorBanner(error: error, onRetry: { Task { await store.retryLoadMore() } })
        } else if store.isLoadingMore {
            ProgressView().frame(maxWidth: .infinity)
        }
    }
}

/// Liste satırı: baş harfler, ad/numara, son mesaj, saat ve durum rozetleri.
struct ConversationRowView: View {

    let conversation: Conversation
    let clock: BranchClock

    var body: some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.md) {
            Text(initials)
                .klinaraText(.bodyEmphasis)
                .foregroundStyle(KlinaraColor.sageDeep)
                .frame(width: 40, height: 40)
                .background(KlinaraColor.sageSoft)
                .clipShape(.circle)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(spacing: KlinaraMetrics.sm) {
                    Text(conversation.title)
                        .klinaraText(conversation.unread ? .bodyEmphasis : .bodyL)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Text(timeLabel)
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }

                Text(preview)
                    .klinaraText(.bodyM)
                    .foregroundStyle(conversation.unread ? KlinaraColor.charcoal : KlinaraColor.charcoalMuted)
                    .lineLimit(2)

                HStack(spacing: KlinaraMetrics.sm) {
                    if conversation.unread {
                        KlinaraBadge(text: "Okunmadı", tone: .positive)
                    }
                    if conversation.customer == nil {
                        KlinaraBadge(text: "Kayıtlı değil", tone: .muted)
                    }
                    if !conversation.isClosed, !conversation.windowOpen {
                        KlinaraBadge(text: "Pencere kapalı", tone: .warning)
                    }
                }
            }
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private var preview: String {
        let text = conversation.lastMessagePreview ?? ""
        return conversation.lastMessageDirection == "out" ? "Siz: \(text)" : text
    }

    private var timeLabel: String {
        clock.isToday(conversation.lastMessageAt)
            ? clock.formatTime(conversation.lastMessageAt)
            : clock.relativeDayLabel(conversation.lastMessageAt)
    }

    private var initials: String {
        guard let name = conversation.customer?.fullName else { return "#" }
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        return String(letters).uppercased(with: Locale(identifier: "tr_TR"))
    }
}
