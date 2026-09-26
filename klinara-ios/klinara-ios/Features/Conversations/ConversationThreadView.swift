import SwiftUI

/// Tek sohbetin akışı ve yazma kutusu.
///
/// Alt kısım üç hâlden birindedir:
/// - pencere açık → serbest metin,
/// - pencere kapalı → uyarı ve "Şablon gönder" (``TemplateSendSheet``),
/// - sohbet kapatılmış → bilgi metni; üst menüden yeniden açılır.
struct ConversationThreadView: View {

    let session: AppSession
    let conversationId: String
    var onChange: ((Conversation) -> Void)?

    @State private var store: ConversationThreadStore?
    @State private var draft = ""
    @State private var showsTemplate = false
    @State private var showsLink = false
    @FocusState private var composerFocused: Bool

    var body: some View {
        Group {
            if let store {
                content(store)
            } else {
                KlinaraSkeletonBody(style: .cards)
                    .padding(KlinaraMetrics.screenInset)
            }
        }
        .background(KlinaraColor.surface)
        .navigationTitle(store?.conversation?.title ?? "Sohbet")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task {
            let current = store ?? ConversationThreadStore(
                service: session.services.conversations,
                conversationId: conversationId
            )
            current.onChange = onChange
            if store == nil {
                store = current
                await current.load()
            }
            // Görünür olduğu sürece yenile; ekran kaybolunca görev iptal olur.
            await current.poll()
        }
        .sheet(isPresented: $showsTemplate) {
            if let store {
                TemplateSendSheet(store: store)
            }
        }
        .sheet(isPresented: $showsLink) {
            if let store {
                LinkCustomerSheet(session: session, store: store)
            }
        }
    }

    // MARK: İçerik

    @ViewBuilder
    private func content(_ store: ConversationThreadStore) -> some View {
        switch store.state {
        case .loading:
            KlinaraSkeletonBody(style: .cards)
                .padding(KlinaraMetrics.screenInset)
        case .failed(let error):
            VStack {
                ErrorBanner(error: error, onRetry: { Task { await store.load() } })
                Spacer()
            }
            .padding(KlinaraMetrics.screenInset)
        case .loaded(let detail):
            thread(detail, store: store)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    bottomBar(detail.conversation, store: store)
                }
        }
    }

    private func thread(_ detail: ConversationDetail, store: ConversationThreadStore) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                    header(detail.conversation)
                    if let error = store.actionError {
                        ErrorBanner(error: error)
                    }
                    ForEach(groups(detail.messages), id: \.day) { group in
                        Text(group.title)
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .padding(.horizontal, KlinaraMetrics.md)
                            .padding(.vertical, KlinaraMetrics.xs)
                            .background(KlinaraColor.surfaceRaised, in: .capsule)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, KlinaraMetrics.sm)
                        ForEach(group.messages) { message in
                            MessageBubble(message: message, clock: session.clock)
                                .id(message.id)
                        }
                    }
                    Color.clear.frame(height: 1).id(Self.bottomId)
                }
                .padding(.horizontal, KlinaraMetrics.md)
                .padding(.vertical, KlinaraMetrics.md)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: detail.messages.last?.id) { _, _ in
                // Yeni balonun ölçüsü ve alt çubuğun payı bir sonraki düzen
                // turunda belli oluyor; hemen kaydırmak balonu çubuğun
                // arkasında bırakıyordu.
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(80))
                    withAnimation { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
                }
            }
        }
    }

    private static let bottomId = "thread-bottom"

    private func header(_ conversation: Conversation) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            Text(ConversationFormat.phone(conversation.phone))
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
            if let remaining = ConversationFormat.windowRemaining(conversation) {
                Text("Cevap penceresi açık · \(remaining) kaldı")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.sageDeep)
            } else {
                KlinaraBadge(text: "Pencere kapalı", tone: .warning)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, KlinaraMetrics.sm)
    }

    // MARK: Alt çubuk

    @ViewBuilder
    private func bottomBar(_ conversation: Conversation, store: ConversationThreadStore) -> some View {
        VStack(spacing: KlinaraMetrics.sm) {
            if conversation.isClosed {
                Text("Bu sohbet kapatıldı. Müşteri yeniden yazarsa kendiliğinden açılır.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if store.canCompose {
                composer(store)
            } else {
                Text("24 saatlik pencere kapalı: serbest mesaj gönderilemez. Onaylı bir şablon gönderebilir ya da müşterinin yeniden yazmasını bekleyebilirsiniz.")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                KlinaraButton(title: "Şablon gönder", icon: "doc.text") {
                    showsTemplate = true
                }
            }
        }
        .padding(.horizontal, KlinaraMetrics.md)
        .padding(.vertical, KlinaraMetrics.sm)
        .background(.bar)
    }

    private func composer(_ store: ConversationThreadStore) -> some View {
        HStack(alignment: .bottom, spacing: KlinaraMetrics.sm) {
            TextField("Mesaj yazın…", text: $draft, axis: .vertical)
                .klinaraText(.bodyL)
                .lineLimit(1...5)
                .focused($composerFocused)
                .padding(.horizontal, KlinaraMetrics.md)
                .padding(.vertical, 10)
                .background(KlinaraColor.surfaceRaised, in: .rect(cornerRadius: 20))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
                )
                .accessibilityLabel("Mesaj")

            Button {
                Task { await submit(store) }
            } label: {
                Group {
                    if store.isSending {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 17, weight: .semibold))
                    }
                }
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(canSend ? KlinaraColor.sage : KlinaraColor.disabled, in: .circle)
            }
            .disabled(!canSend || store.isSending)
            .accessibilityLabel("Gönder")
        }
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit(_ store: ConversationThreadStore) async {
        // Taslak YALNIZ mesaj kaydedildiyse temizlenir; ağ hatasında kullanıcı
        // yazdığını kaybetmesin.
        if await store.send(draft) != nil {
            draft = ""
        }
    }

    // MARK: Araç çubuğu

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let store, let conversation = store.conversation {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let customer = conversation.customer, session.can(Permissions.customerRead) {
                        NavigationLink {
                            CustomerDetailView(session: session, customerId: customer.id)
                        } label: {
                            Label("Müşteri kartını aç", systemImage: "person.crop.circle")
                        }
                    } else if conversation.customer == nil, session.can(Permissions.customerRead) {
                        Button {
                            showsLink = true
                        } label: {
                            Label("Müşteriye bağla", systemImage: "person.crop.circle.badge.plus")
                        }
                    }
                    if conversation.isClosed {
                        Button {
                            Task { await store.setClosed(false) }
                        } label: {
                            Label("Yeniden aç", systemImage: "tray.and.arrow.up")
                        }
                    } else {
                        Button {
                            Task { await store.setClosed(true) }
                        } label: {
                            Label("Sohbeti kapat", systemImage: "archivebox")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .disabled(store.isUpdatingStatus)
                .accessibilityLabel("Sohbet işlemleri")
            }
        }
    }

    // MARK: Gruplama

    private struct DayGroup {
        let day: Date
        let title: String
        let messages: [ConversationMessage]
    }

    private func groups(_ messages: [ConversationMessage]) -> [DayGroup] {
        let clock = session.clock
        var order: [Date] = []
        var byDay: [Date: [ConversationMessage]] = [:]
        for message in messages {
            let day = clock.startOfDay(message.createdAt)
            if byDay[day] == nil { order.append(day) }
            byDay[day, default: []].append(message)
        }
        return order.map { DayGroup(day: $0, title: clock.relativeDayLabel($0), messages: byDay[$0] ?? []) }
    }
}

/// Tek mesaj balonu. Giden sağda, gelen solda; başarısız giden kırmızı.
struct MessageBubble: View {

    let message: ConversationMessage
    let clock: BranchClock

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                if let sender = message.senderLabel {
                    Text(sender)
                        .klinaraText(.bodyEmphasis)
                        .font(.caption)
                        .foregroundStyle(KlinaraColor.sageDeep)
                }
                Text(message.displayBody)
                    .klinaraText(.bodyL)
                    .foregroundStyle(message.body == nil ? KlinaraColor.charcoalMuted : KlinaraColor.charcoal)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if message.isFailed, let detail = message.errorDetail {
                    Label(detail, systemImage: "exclamationmark.circle")
                        .klinaraText(.bodyM)
                        .font(.caption)
                        .foregroundStyle(KlinaraColor.danger)
                }
                HStack(spacing: KlinaraMetrics.xs) {
                    Spacer(minLength: 0)
                    Text(clock.formatTime(message.createdAt))
                        .font(.caption2)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                    if message.isOutgoing, let status = message.status {
                        Image(systemName: statusIcon(status))
                            .font(.caption2)
                            .foregroundStyle(status == .failed ? KlinaraColor.danger : KlinaraColor.charcoalMuted)
                            .accessibilityLabel(status.turkishName)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(background, in: .rect(cornerRadius: 18))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(border, lineWidth: KlinaraMetrics.borderWidth)
            )
            if !message.isOutgoing { Spacer(minLength: 48) }
        }
        .accessibilityElement(children: .combine)
    }

    private var background: Color {
        if message.isFailed { return KlinaraColor.danger.opacity(0.08) }
        return message.isOutgoing ? KlinaraColor.sageSoft : KlinaraColor.surfaceRaised
    }

    private var border: Color {
        if message.isFailed { return KlinaraColor.danger.opacity(0.4) }
        return message.isOutgoing ? KlinaraColor.sage.opacity(0.3) : KlinaraColor.border
    }

    private func statusIcon(_ status: MessageStatus) -> String {
        switch status {
        case .queued, .sending: return "clock"
        case .sent: return "checkmark"
        case .delivered, .read: return "checkmark.circle"
        case .failed, .skipped: return "exclamationmark.circle"
        case .unknown: return "questionmark.circle"
        }
    }
}
