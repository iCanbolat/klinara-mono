import Foundation

/// Sunucu olmadan Sohbetler ekranını sürmek için bellek-içi defter.
///
/// Sunucunun kurallarını taklit eder — mock farklı davranırsa arayüz canlıda
/// ilk denemede yanılır:
///
/// - Pencere kapalıyken serbest metin `422 WHATSAPP_WINDOW_CLOSED`; kayıt
///   bırakılmaz.
/// - Şablon pencereden bağımsız gider; parametre sayısı tutmazsa `422`.
/// - Gönderim hatası HTTP hatası değil, `failed` mesaj — tohumdaki kayıtlı
///   olmayan numaranın akışında bir örneği duruyor.
/// - Pencere bir şablonla AÇILMAZ: müşteri yazana kadar kapalı kalır.
final class MockConversationsService: ConversationsService, @unchecked Sendable {

    private let lock = NSLock()
    private let latencyEnabled: Bool
    private var records: [Conversation] = []
    private var threads: [String: [ConversationMessage]] = [:]
    private var templates: [ConversationTemplateOption] = []

    /// Yoklamanın durduğunu sınamak için.
    private(set) var detailRequestCount = 0

    init(latencyEnabled: Bool = true) {
        self.latencyEnabled = latencyEnabled
        seed()
    }

    func reseed() {
        withLock { seed() }
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.3) async {
        guard latencyEnabled else { return }
        try? await Task.sleep(for: .seconds(seconds))
    }

    private func problem(_ code: APIErrorCode, _ title: String, status: Int = 422) -> APIError {
        .problem(ProblemDetails(code: code, title: title, status: status))
    }

    // MARK: Tohum

    static let openId = "cv000000-0000-4000-8000-000000000001"
    static let closedWindowId = "cv000000-0000-4000-8000-000000000002"
    static let archivedId = "cv000000-0000-4000-8000-000000000003"

    private func seed() {
        let now = Date()
        func ago(_ minutes: Double) -> Date { now.addingTimeInterval(-minutes * 60) }
        detailRequestCount = 0

        records = [
            Conversation(
                id: Self.openId,
                phone: "+905321234567",
                customer: ConversationCustomer(id: MockCustomerSeed.ayse, fullName: "Ayşe Yılmaz"),
                status: .open,
                lastMessageAt: ago(4),
                lastMessagePreview: "Yarınki randevumu 15:00'e alabilir miyiz?",
                lastMessageDirection: "in",
                unread: true,
                windowOpen: true,
                windowExpiresAt: ago(4).addingTimeInterval(24 * 3600)
            ),
            Conversation(
                id: Self.closedWindowId,
                phone: "+905559998877",
                customer: nil,
                status: .open,
                lastMessageAt: ago(60 * 30),
                lastMessagePreview: "Merhaba, hangi hizmet için bilgi istersiniz?",
                lastMessageDirection: "out",
                unread: false,
                windowOpen: false,
                windowExpiresAt: ago(60 * 31).addingTimeInterval(24 * 3600)
            ),
            Conversation(
                id: Self.archivedId,
                phone: "+905337654321",
                customer: ConversationCustomer(id: MockCustomerSeed.mehmet, fullName: "Mehmet Demir"),
                status: .closed,
                lastMessageAt: ago(60 * 50),
                lastMessagePreview: "Teşekkürler, görüşmek üzere.",
                lastMessageDirection: "in",
                unread: false,
                windowOpen: false,
                windowExpiresAt: ago(60 * 50).addingTimeInterval(24 * 3600)
            ),
        ]

        threads = [
            Self.openId: [
                message("m-1", .inbound, "Merhaba, randevum için yazıyorum.", ago(60 * 26)),
                message("m-2", .auto("appointment_reminder"), "Sayın Ayşe Yılmaz, yarın 11:00 randevunuzu hatırlatırız.", ago(60 * 20)),
                message("m-3", .inbound, "Yarınki randevumu 15:00'e alabilir miyiz?", ago(4)),
            ],
            Self.closedWindowId: [
                message("m-4", .inbound, "Merhaba, fiyat bilgisi alabilir miyim?", ago(60 * 31)),
                message(
                    "m-5",
                    .staff,
                    "Merhaba, hangi hizmet için bilgi istersiniz?",
                    ago(60 * 30),
                    status: .failed,
                    error: "Alıcı bir WhatsApp kullanıcısı değil"
                ),
            ],
            Self.archivedId: [
                message("m-6", .staff, "Randevunuz 14:00'e alındı.", ago(60 * 51)),
                message("m-7", .inbound, "Teşekkürler, görüşmek üzere.", ago(60 * 50)),
            ],
        ]

        templates = [
            ConversationTemplateOption(
                name: "klinara_gelmedi_takip",
                language: "tr",
                category: "UTILITY",
                bodyText: "Merhaba {{1}}, bugünkü randevunuza gelemediğinizi gördük. Yeni bir randevu için {{2}} şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
                bodyVariableCount: 2,
                variableNames: ["customerName", "branchName"],
                suggestedParameters: ["", "Nişantaşı"]
            ),
            ConversationTemplateOption(
                name: "klinara_paket_bakiye",
                language: "tr",
                category: "UTILITY",
                bodyText: "Merhaba {{1}}, {{2}} paketinizde {{3}} seans hakkınız kaldı. Randevu için bu mesajı yanıtlayabilirsiniz.",
                bodyVariableCount: 3,
                variableNames: ["customerName", "packageName", "remainingSessions"],
                suggestedParameters: ["", "", ""]
            ),
        ]
    }

    private enum Sender {
        case inbound
        case staff
        case auto(String)
    }

    private func message(
        _ id: String,
        _ sender: Sender,
        _ body: String,
        _ at: Date,
        type: String? = nil,
        status: MessageStatus = .read,
        error: String? = nil
    ) -> ConversationMessage {
        switch sender {
        case .inbound:
            return ConversationMessage(
                id: id, direction: "in", type: type ?? "text", body: body, createdAt: at,
                status: nil, event: nil, sentByName: nil, errorDetail: nil, appointmentId: nil
            )
        case .staff:
            return ConversationMessage(
                id: id, direction: "out", type: type ?? "text", body: body, createdAt: at,
                status: status, event: "staff_reply", sentByName: "Selin Aydın",
                errorDetail: error, appointmentId: nil
            )
        case .auto(let event):
            return ConversationMessage(
                id: id, direction: "out", type: "template", body: body, createdAt: at,
                status: status, event: event, sentByName: nil, errorDetail: nil, appointmentId: nil
            )
        }
    }

    // MARK: ConversationsService

    func conversations(filter: ConversationFilter, cursor: String?, limit: Int?) async throws -> Page<Conversation> {
        await latency()
        return withLock {
            let matching = records
                .filter { row in
                    switch filter {
                    case .open: return row.status == .open
                    case .unread: return row.status == .open && row.unread
                    case .closed: return row.status == .closed
                    }
                }
                .sorted { $0.lastMessageAt > $1.lastMessageAt }
            let start = cursor.flatMap(Int.init) ?? 0
            let size = limit ?? 50
            let page = Array(matching.dropFirst(start).prefix(size))
            let next = start + page.count
            return Page(
                data: page,
                pageInfo: PageInfo(
                    nextCursor: next < matching.count ? String(next) : nil,
                    hasMore: next < matching.count
                )
            )
        }
    }

    func unreadCount() async throws -> Int {
        await latency(0.1)
        return withLock { records.count { $0.status == .open && $0.unread } }
    }

    func conversation(id: String) async throws -> ConversationDetail {
        await latency()
        return try withLock {
            detailRequestCount += 1
            guard let row = records.first(where: { $0.id == id }) else {
                throw problem(.notFound, "Sohbet bulunamadı", status: 404)
            }
            return ConversationDetail(conversation: row, messages: threads[id] ?? [])
        }
    }

    func send(conversationId: String, body: String) async throws -> ConversationMessage {
        await latency()
        return try withLock {
            guard let row = records.first(where: { $0.id == conversationId }) else {
                throw problem(.notFound, "Sohbet bulunamadı", status: 404)
            }
            let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw problem(.validationFailed, "Mesaj boş olamaz") }
            guard row.windowOpen else {
                throw problem(
                    .whatsappWindowClosed,
                    "Müşterinin son mesajının üzerinden 24 saat geçti"
                )
            }
            return append(to: row, body: trimmed, type: "text")
        }
    }

    func templateOptions(conversationId: String) async throws -> [ConversationTemplateOption] {
        await latency()
        return try withLock {
            guard let row = records.first(where: { $0.id == conversationId }) else {
                throw problem(.notFound, "Sohbet bulunamadı", status: 404)
            }
            // Öneri sunucuda olduğu gibi: bağlı müşterinin adı, yoksa boş.
            return templates.map { option in
                var suggested = option.suggestedParameters
                if let index = option.variableNames.firstIndex(of: "customerName") {
                    suggested[index] = row.customer?.fullName ?? ""
                }
                return ConversationTemplateOption(
                    name: option.name,
                    language: option.language,
                    category: option.category,
                    bodyText: option.bodyText,
                    bodyVariableCount: option.bodyVariableCount,
                    variableNames: option.variableNames,
                    suggestedParameters: suggested
                )
            }
        }
    }

    func sendTemplate(conversationId: String, _ input: SendConversationTemplateInput) async throws -> ConversationMessage {
        await latency()
        return try withLock {
            guard let row = records.first(where: { $0.id == conversationId }) else {
                throw problem(.notFound, "Sohbet bulunamadı", status: 404)
            }
            guard let template = templates.first(where: {
                $0.name == input.templateName && $0.language == input.language
            }) else {
                throw problem(.whatsappTemplateNotApproved, "Bu şablon sohbetten gönderilemez")
            }
            guard template.isComplete(input.parameters) else {
                throw problem(.validationFailed, "Şablon parametreleri eksik")
            }
            return append(to: row, body: template.render(input.parameters), type: "template")
        }
    }

    func markRead(conversationId: String) async throws {
        await latency(0.1)
        withLock {
            guard let index = records.firstIndex(where: { $0.id == conversationId }) else { return }
            records[index] = records[index].with(unread: false)
        }
    }

    func setClosed(conversationId: String, closed: Bool) async throws -> Conversation {
        await latency()
        return try withLock {
            guard let index = records.firstIndex(where: { $0.id == conversationId }) else {
                throw problem(.notFound, "Sohbet bulunamadı", status: 404)
            }
            records[index] = records[index].with(unread: closed ? false : nil, status: closed ? .closed : .open)
            return records[index]
        }
    }

    func linkCustomer(conversationId: String, customerId: String) async throws -> Conversation {
        await latency()
        return try withLock {
            guard let index = records.firstIndex(where: { $0.id == conversationId }) else {
                throw problem(.notFound, "Sohbet bulunamadı", status: 404)
            }
            let row = records[index]
            let names = [MockCustomerSeed.ayse: "Ayşe Yılmaz", MockCustomerSeed.mehmet: "Mehmet Demir"]
            records[index] = Conversation(
                id: row.id,
                phone: row.phone,
                customer: ConversationCustomer(id: customerId, fullName: names[customerId] ?? "Müşteri"),
                status: row.status,
                lastMessageAt: row.lastMessageAt,
                lastMessagePreview: row.lastMessagePreview,
                lastMessageDirection: row.lastMessageDirection,
                unread: row.unread,
                windowOpen: row.windowOpen,
                windowExpiresAt: row.windowExpiresAt
            )
            return records[index]
        }
    }

    // MARK: Yardımcı

    /// Kilit altında çağrılır.
    private func append(to row: Conversation, body: String, type: String) -> ConversationMessage {
        let sent = ConversationMessage(
            id: UUID().uuidString.lowercased(),
            direction: "out",
            type: type,
            body: body,
            createdAt: Date(),
            status: .sent,
            event: "staff_reply",
            sentByName: "Selin Aydın",
            errorDetail: nil,
            appointmentId: nil
        )
        threads[row.id, default: []].append(sent)
        if let index = records.firstIndex(where: { $0.id == row.id }) {
            records[index] = records[index].with(unread: false, lastMessage: sent)
        }
        return sent
    }
}
