import SwiftUI

/// Tek sohbetin akışı ve yazma kutusu.
///
/// Açık sohbet OKUNMUŞ sayılır: işaret sunucuya yazılır ve satır yerel olarak
/// güncellenir ki listedeki rozet hemen düşsün.
///
/// Yoklama ``poll(every:)`` ile yapılır ve görünümün `.task`ına bağlıdır:
/// ekran kaybolunca görev iptal edilir ve yoklama durur. Push kanalı olmadığı
/// için tek yol bu; ama arka planda dönen bir döngü pili boşuna tüketirdi.
@MainActor
@Observable
final class ConversationThreadStore {

    private let service: any ConversationsService
    let conversationId: String
    /// Sohbet satırı değişti — listeye iletilir.
    var onChange: ((Conversation) -> Void)?

    private(set) var state: LoadState<ConversationDetail> = .loading
    private(set) var isSending = false
    private(set) var isUpdatingStatus = false
    /// Gönderim ya da durum değişikliği hatası; akışın üstünde gösterilir.
    private(set) var actionError: APIError?

    init(service: any ConversationsService, conversationId: String) {
        self.service = service
        self.conversationId = conversationId
    }

    var detail: ConversationDetail? { state.value }
    var conversation: Conversation? { detail?.conversation }
    var messages: [ConversationMessage] { detail?.messages ?? [] }

    /// Serbest metin yazılabilir mi: sohbet açık VE pencere açık.
    var canCompose: Bool {
        guard let conversation else { return false }
        return !conversation.isClosed && conversation.windowOpen
    }

    /// Pencere kapalı ama sohbet açık — yalnız şablon gönderilebilir.
    var needsTemplate: Bool {
        guard let conversation else { return false }
        return !conversation.isClosed && !conversation.windowOpen
    }

    func load() async {
        do {
            var result = try await service.conversation(id: conversationId)
            if result.conversation.unread {
                let read = result.conversation.with(unread: false)
                result = ConversationDetail(conversation: read, messages: result.messages)
                try? await service.markRead(conversationId: conversationId)
                onChange?(read)
            }
            state = .loaded(result)
        } catch {
            // Yoklamadaki geçici hata yüklü akışı silmez.
            if state.value == nil { state = .failed(error as? APIError ?? .network) }
        }
    }

    /// Görünür olduğu sürece periyodik yenileme; görev iptal edilince durur.
    func poll(every interval: Duration = .seconds(5)) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: interval)
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    /// `nil` → istek hiç kaydedilemedi (ağ, pencere kapalı). Meta hatası ise
    /// `failed` bir mesaj olarak döner ve akışa eklenir.
    @discardableResult
    func send(_ body: String) async -> ConversationMessage? {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return nil }
        isSending = true
        actionError = nil
        defer { isSending = false }
        do {
            let message = try await service.send(conversationId: conversationId, body: trimmed)
            append(message)
            return message
        } catch {
            actionError = error as? APIError ?? .network
            // Pencere bu arada kapanmış olabilir: sunucunun görüşüne dön.
            if case .problem(let problem) = actionError, problem.code == .whatsappWindowClosed {
                await load()
            }
            return nil
        }
    }

    func templateOptions() async throws -> [ConversationTemplateOption] {
        try await service.templateOptions(conversationId: conversationId)
    }

    /// Hata fırlatır ki şablon sayfası kendi içinde gösterebilsin.
    func sendTemplate(_ option: ConversationTemplateOption, values: [String]) async throws -> ConversationMessage {
        let message = try await service.sendTemplate(
            conversationId: conversationId,
            SendConversationTemplateInput(
                templateName: option.name,
                language: option.language,
                parameters: values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            )
        )
        append(message)
        return message
    }

    func setClosed(_ closed: Bool) async {
        isUpdatingStatus = true
        actionError = nil
        defer { isUpdatingStatus = false }
        do {
            let updated = try await service.setClosed(conversationId: conversationId, closed: closed)
            replace(updated)
        } catch {
            actionError = error as? APIError ?? .network
        }
    }

    func linkCustomer(_ customerId: String) async throws {
        let updated = try await service.linkCustomer(conversationId: conversationId, customerId: customerId)
        replace(updated)
        await load()
    }

    func dismissError() { actionError = nil }

    private func append(_ message: ConversationMessage) {
        guard let detail else { return }
        let conversation = detail.conversation.with(unread: false, lastMessage: message)
        state = .loaded(ConversationDetail(conversation: conversation, messages: detail.messages + [message]))
        onChange?(conversation)
    }

    private func replace(_ conversation: Conversation) {
        guard let detail else { return }
        state = .loaded(ConversationDetail(conversation: conversation, messages: detail.messages))
        onChange?(conversation)
    }
}
