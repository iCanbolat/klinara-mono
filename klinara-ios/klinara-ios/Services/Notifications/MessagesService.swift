import Foundation

/// Mesaj günlüğü (Faz 8.1).
///
/// Tek uçlu ayrı bir sözleşme olmasının sebebi izin ailesi: `notification:read`
/// salt okuma rollerinde (`accountant`) de var, `notification:manage` yok.
/// ``NotificationsService`` ile birleştirmek, günlüğü okuyabilen bir role
/// şablon yazma metotlarını da göstermek olurdu.
protocol MessagesService: Sendable {

    /// `GET /messages` — cursor sayfalamalı (`{ data, pageInfo }`), en yeni önce.
    ///
    /// `limit` 1–200; verilmezse sunucu 50 kullanır. `cursor` opak
    /// (`createdAt|id`'nin base64url'ü) — istemci onu **üretmez**, yalnız taşır.
    func messages(cursor: String?, limit: Int?, filter: MessageFilter) async throws -> Page<Message>
}

struct LiveMessagesService: MessagesService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func messages(
        cursor: String?,
        limit: Int?,
        filter: MessageFilter
    ) async throws -> Page<Message> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let customerId = filter.customerId {
            query.append(URLQueryItem(name: "customerId", value: customerId))
        }
        if let channel = filter.channel {
            query.append(URLQueryItem(name: "channel", value: channel.rawValue))
        }
        if let event = filter.event {
            query.append(URLQueryItem(name: "event", value: event.rawValue))
        }
        if let status = filter.status {
            query.append(URLQueryItem(name: "status", value: status.rawValue))
        }
        if let from = filter.from { query.append(URLQueryItem(name: "from", value: from)) }
        if let to = filter.to { query.append(URLQueryItem(name: "to", value: to)) }
        return try await client.send(APIRequest.get("messages", query: query))
    }
}
