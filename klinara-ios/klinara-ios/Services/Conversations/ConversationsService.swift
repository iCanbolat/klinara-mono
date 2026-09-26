import Foundation

/// Resepsiyonun WhatsApp sohbetleri (`/conversations`).
///
/// Kapı `notification:send`: sohbet ekranı müşteriyle yazışmanın kendisi.
/// Gönderim hatası bir HTTP hatası **değildir** — mesaj `status: failed` ve
/// `errorDetail` ile döner ki balon kırmızı çizilip sebebi gösterilebilsin.
protocol ConversationsService: Sendable {

    /// `GET /conversations` — son mesaja göre yeniden eskiye, cursor'lu.
    func conversations(filter: ConversationFilter, cursor: String?, limit: Int?) async throws -> Page<Conversation>

    /// `GET /conversations/unread-count` — menü rozeti.
    func unreadCount() async throws -> Int

    /// `GET /conversations/:id` — sohbet ve son 200 mesaj.
    func conversation(id: String) async throws -> ConversationDetail

    /// `POST /conversations/:id/messages` — pencere kapalıysa `422 WHATSAPP_WINDOW_CLOSED`.
    func send(conversationId: String, body: String) async throws -> ConversationMessage

    /// `GET /conversations/:id/templates` — onaylı, butonsuz şablonlar; önerilerle.
    func templateOptions(conversationId: String) async throws -> [ConversationTemplateOption]

    /// `POST /conversations/:id/template` — pencereden bağımsız.
    func sendTemplate(conversationId: String, _ input: SendConversationTemplateInput) async throws -> ConversationMessage

    /// `POST /conversations/:id/read` — `204`.
    func markRead(conversationId: String) async throws

    /// `POST /conversations/:id/close|reopen`.
    func setClosed(conversationId: String, closed: Bool) async throws -> Conversation

    /// `PUT /conversations/:id/customer` — ayrıca `customer:read` ister.
    func linkCustomer(conversationId: String, customerId: String) async throws -> Conversation
}

struct LiveConversationsService: ConversationsService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func conversations(filter: ConversationFilter, cursor: String?, limit: Int?) async throws -> Page<Conversation> {
        var query = filter.query
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(APIRequest.get("conversations", query: query))
    }

    func unreadCount() async throws -> Int {
        let result: UnreadConversationCount = try await client.send(APIRequest.get("conversations/unread-count"))
        return result.count
    }

    func conversation(id: String) async throws -> ConversationDetail {
        try await client.send(APIRequest.get("conversations/\(id)"))
    }

    func send(conversationId: String, body: String) async throws -> ConversationMessage {
        try await client.send(APIRequest.post(
            "conversations/\(conversationId)/messages",
            body: SendConversationMessageInput(body: body)
        ))
    }

    func templateOptions(conversationId: String) async throws -> [ConversationTemplateOption] {
        try await client.send(APIRequest.get("conversations/\(conversationId)/templates"))
    }

    func sendTemplate(conversationId: String, _ input: SendConversationTemplateInput) async throws -> ConversationMessage {
        try await client.send(APIRequest.post("conversations/\(conversationId)/template", body: input))
    }

    func markRead(conversationId: String) async throws {
        try await client.send(APIRequest.post("conversations/\(conversationId)/read"))
    }

    func setClosed(conversationId: String, closed: Bool) async throws -> Conversation {
        try await client.send(APIRequest.post("conversations/\(conversationId)/\(closed ? "close" : "reopen")"))
    }

    func linkCustomer(conversationId: String, customerId: String) async throws -> Conversation {
        try await client.send(APIRequest.put(
            "conversations/\(conversationId)/customer",
            body: LinkConversationCustomerInput(customerId: customerId)
        ))
    }
}
