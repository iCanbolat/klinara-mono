import Foundation

// Kaynak: `apps/api/src/modules/integrations/dto/conversation.dto.ts` ve
// `packages/shared/src/messaging-api.ts` (`Conversation`, `ConversationMessage`,
// `ConversationTemplateOption`).
//
// Sohbet bir NUMARAYA bağlı, müşteriye değil: kayıtlı olmayan bir numara da
// yazabilir ve o sohbetin `customer`ı `nil` gelir.

/// Sohbetin durumu. **Açık** küme — bilinmeyen değer `.unknown`.
nonisolated enum ConversationStatus: String, Decodable, Sendable {
    case open
    case closed
    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ConversationStatus(rawValue: raw) ?? .unknown
    }
}

nonisolated struct ConversationCustomer: Decodable, Sendable, Equatable, Hashable {
    let id: String
    let fullName: String
}

/// `ConversationDto`.
nonisolated struct Conversation: Decodable, Sendable, Identifiable, Equatable, Hashable {
    let id: String
    /// E.164.
    let phone: String
    let customer: ConversationCustomer?
    let status: ConversationStatus
    let lastMessageAt: Date
    let lastMessagePreview: String?
    /// `in` | `out` — listede "Siz: " öneki için.
    let lastMessageDirection: String?
    let unread: Bool
    /// 24 saatlik pencere — kapalıyken serbest metin gönderilemez.
    let windowOpen: Bool
    let windowExpiresAt: Date?

    var isClosed: Bool { status == .closed }

    /// Liste ve başlık: müşteri adı, yoksa biçimlenmiş numara.
    var title: String { customer?.fullName ?? ConversationFormat.phone(phone) }

    func with(
        unread: Bool? = nil,
        status: ConversationStatus? = nil,
        lastMessage: ConversationMessage? = nil
    ) -> Conversation {
        Conversation(
            id: id,
            phone: phone,
            customer: customer,
            status: status ?? self.status,
            lastMessageAt: lastMessage?.createdAt ?? lastMessageAt,
            lastMessagePreview: lastMessage?.body ?? lastMessagePreview,
            lastMessageDirection: lastMessage == nil ? lastMessageDirection : "out",
            unread: unread ?? self.unread,
            windowOpen: windowOpen,
            windowExpiresAt: windowExpiresAt
        )
    }
}

/// `ConversationMessageDto` — gelen ve giden mesajlar tek akışta.
nonisolated struct ConversationMessage: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    /// `in` | `out`.
    let direction: String
    /// Gelen: Meta'nın tipi (`text`, `button`, `image`…). Giden: `text` | `template`.
    let type: String
    let body: String?
    let createdAt: Date
    /// Yalnız giden. Bilinmeyen değer ``MessageStatus/unknown``.
    let status: MessageStatus?
    /// Yalnız giden: bildirim olayı (`staff_reply`, `appointment_reminder`…).
    let event: String?
    let sentByName: String?
    let errorDetail: String?
    let appointmentId: String?

    var isOutgoing: Bool { direction == "out" }
    var isTemplate: Bool { type == "template" }
    var isFailed: Bool { status == .failed || status == .skipped }

    /// Balonun üst satırı: kimin/neyin gönderdiği.
    var senderLabel: String? {
        guard isOutgoing else { return nil }
        if let event, let label = ConversationFormat.eventLabel(event) {
            return "Otomatik · \(label)"
        }
        let name = sentByName ?? "Otomatik"
        return isTemplate ? "\(name) · Şablon" : name
    }

    /// Metin dışı gelen mesajların gövdesi boş olabilir.
    var displayBody: String {
        if let body, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return body }
        return ConversationFormat.inboundTypeLabel(type)
    }
}

/// `ConversationDetailDto` — son 200 mesaj, eskiden yeniye.
nonisolated struct ConversationDetail: Decodable, Sendable, Equatable {
    let conversation: Conversation
    let messages: [ConversationMessage]
}

/// `ConversationTemplateOptionDto` — pencere kapalıyken gönderilebilecek şablon.
nonisolated struct ConversationTemplateOption: Decodable, Sendable, Identifiable, Equatable, Hashable {
    let name: String
    let language: String
    /// Sunucu yalnız işlemsel (`UTILITY`) şablon öneriyor.
    let category: String
    /// `{{1}}` yer tutucularıyla gövde.
    let bodyText: String
    let bodyVariableCount: Int
    /// Değişken adları; bilinmiyorsa `nil`.
    let variableNames: [String?]
    /// Önerilen değerler; öneri yoksa boş metin.
    let suggestedParameters: [String]

    var id: String { "\(name)|\(language)" }

    /// Alan etiketi: bilinen değişken adı Türkçe, bilinmeyen "n. değişken".
    func label(at index: Int) -> String {
        let name = index < variableNames.count ? variableNames[index] : nil
        return name.flatMap(ConversationFormat.variableLabel) ?? "\(index + 1). değişken"
    }

    /// `{{n}}` → değer; boş değer yer tutucuyu korur ki eksik alan görünsün.
    func render(_ values: [String]) -> String {
        var result = bodyText
        for index in (0..<bodyVariableCount).reversed() {
            let value = index < values.count
                ? values[index].trimmingCharacters(in: .whitespacesAndNewlines)
                : ""
            guard !value.isEmpty else { continue }
            result = result.replacingOccurrences(of: "{{\(index + 1)}}", with: value)
        }
        return result
    }

    func isComplete(_ values: [String]) -> Bool {
        values.count == bodyVariableCount
            && values.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
}

nonisolated struct SendConversationMessageInput: Encodable, Sendable, Equatable {
    let body: String
}

nonisolated struct SendConversationTemplateInput: Encodable, Sendable, Equatable {
    let templateName: String
    let language: String
    let parameters: [String]
}

nonisolated struct LinkConversationCustomerInput: Encodable, Sendable, Equatable {
    let customerId: String
}

nonisolated struct UnreadConversationCount: Decodable, Sendable, Equatable {
    let count: Int
}

/// Liste süzgeci — web'deki üç sekmeyle aynı.
nonisolated enum ConversationFilter: String, CaseIterable, Identifiable, Sendable {
    case open
    case unread
    case closed

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .open: return "Açık"
        case .unread: return "Okunmamış"
        case .closed: return "Kapalı"
        }
    }

    var query: [URLQueryItem] {
        switch self {
        case .open: return [URLQueryItem(name: "status", value: "open")]
        case .unread:
            return [
                URLQueryItem(name: "status", value: "open"),
                URLQueryItem(name: "unreadOnly", value: "true"),
            ]
        case .closed: return [URLQueryItem(name: "status", value: "closed")]
        }
    }
}

/// Görünüm metinleri — web'deki `lib/messages/format.ts` karşılığı.
nonisolated enum ConversationFormat {

    /// `+905321234567` → `+90 532 123 45 67`; tanımadığını olduğu gibi bırakır.
    static func phone(_ e164: String) -> String {
        let digits = e164.dropFirst(3)
        guard e164.hasPrefix("+90"), digits.count == 10, digits.allSatisfy(\.isNumber) else {
            return e164
        }
        let chars = Array(digits)
        return "+90 \(String(chars[0..<3])) \(String(chars[3..<6])) \(String(chars[6..<8])) \(String(chars[8..<10]))"
    }

    /// Kalan pencere süresi ("5 sa 12 dk"); kapalıysa `nil`.
    static func windowRemaining(_ conversation: Conversation, now: Date = Date()) -> String? {
        guard conversation.windowOpen, let expires = conversation.windowExpiresAt else { return nil }
        let minutes = Int(expires.timeIntervalSince(now) / 60)
        guard minutes > 0 else { return nil }
        let hours = minutes / 60
        return hours > 0 ? "\(hours) sa \(minutes % 60) dk" : "\(minutes) dk"
    }

    static func eventLabel(_ event: String) -> String? {
        switch event {
        case "appointment_confirmation": return "Randevu onayı"
        case "appointment_reminder": return "Randevu hatırlatması"
        case "appointment_cancelled": return "İptal bildirimi"
        case "no_show_followup": return "Gelmedi takibi"
        case "package_balance": return "Paket bakiyesi"
        case "package_expiring": return "Paket süresi"
        case "auto_reply": return "Otomatik cevap"
        default: return nil
        }
    }

    static func inboundTypeLabel(_ type: String) -> String {
        switch type {
        case "image": return "Fotoğraf gönderdi"
        case "audio": return "Sesli mesaj gönderdi"
        case "video": return "Video gönderdi"
        case "document": return "Belge gönderdi"
        case "location": return "Konum gönderdi"
        case "sticker": return "Çıkartma gönderdi"
        case "button": return "Butonla yanıtladı"
        default: return "Desteklenmeyen mesaj — telefondan görüntüleyin"
        }
    }

    static func variableLabel(_ name: String) -> String? {
        switch name {
        case "customerName": return "Müşteri adı"
        case "branchName": return "Şube / klinik adı"
        case "appointmentAt": return "Randevu zamanı"
        case "serviceName": return "Hizmet"
        case "packageName": return "Paket"
        case "remainingSessions": return "Kalan seans"
        case "expiresAt": return "Bitiş tarihi"
        default: return nil
        }
    }
}
