import Foundation

// Kaynak: `apps/api/src/modules/notifications/dto/notification.dto.ts`
// (`MessageResponseDto`, `ListMessagesQueryDto`).
//
// Ek M kararı ekranı doğrudan biçimlendiriyor: **ham adres saklanmıyor**
// (`to` maskeli gelir) ve **engellenen mesaj atılmıyor, `skipped` yazılıyor**.
// Mesaj günlüğü bu yüzden "ne gitti" değil "ne oldu" defteridir; `skipped`
// satırları gizlenmez.

/// Gönderim durumu.
///
/// **Açık** küme: sunucu ileride yeni bir durum ekleyebilir (`expired` gibi) ve
/// eski bir istemcinin tüm günlüğü çözememesi kabul edilemez.
nonisolated enum MessageStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case queued
    case sending
    case sent
    case delivered
    case read
    case failed
    case skipped
    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = MessageStatus(rawValue: raw) ?? .unknown
    }

    var id: String { rawValue }

    static var selectable: [MessageStatus] { allCases.filter { $0 != .unknown } }

    var turkishName: String {
        switch self {
        case .queued: return "Kuyrukta"
        case .sending: return "Gönderiliyor"
        case .sent: return "Gönderildi"
        case .delivered: return "Ulaştı"
        case .read: return "Okundu"
        case .failed: return "Başarısız"
        case .skipped: return "Gönderilmedi"
        case .unknown: return "Bilinmiyor"
        }
    }

    var explanation: String {
        switch self {
        case .queued: return "Sırada bekliyor. Sessiz saatte üretilen mesaj sabaha ertelenir."
        case .sending: return "Sağlayıcıya iletiliyor."
        case .sent: return "Sağlayıcı kabul etti."
        case .delivered: return "Müşterinin cihazına ulaştı."
        case .read: return "Müşteri okudu."
        case .failed: return "Gönderilemedi. Sebebi aşağıda."
        case .skipped: return "Üretildi ama gönderilmedi — iletişim izni kapalı ya da kanal yapılandırılmamış."
        case .unknown: return "Bu sürümde tanınmayan bir durum. Uygulamayı güncelleyin."
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .sent, .delivered, .read: return .positive
        case .failed: return .warning
        case .queued, .sending: return .neutral
        case .skipped, .unknown: return .muted
        }
    }
}

/// `MessageResponseDto`.
nonisolated struct Message: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let customerId: String?
    let userId: String?
    let channel: NotificationChannel
    let event: NotificationEvent
    let status: MessageStatus
    /// **Maskeli** adres (`+90**********67`). Ham adres sunucuda da saklanmıyor;
    /// gönderim anında müşteri satırından yeniden çözülüyor.
    let to: String
    let subject: String?
    let body: String?
    /// `packages/shared/src/error-codes.ts` değeri; ``APIErrorCode`` ile eşlenir.
    let errorCode: String?
    let attempt: Int
    let scheduledFor: Date
    let sentAt: Date?
    let deliveredAt: Date?
    let createdAt: Date

    /// Başarısız satırda sebebi kullanıcı diliyle söyleyebilmek için.
    /// Bilinmeyen kod ham haliyle gösterilir — sakladığımızda destek kaydı yok olurdu.
    var failureMessage: String? {
        guard let errorCode else { return nil }
        guard let code = APIErrorCode(rawValue: errorCode), code != .unknown else { return errorCode }
        return APIError.problem(ProblemDetails(code: code, title: "", status: 0)).displayMessage
    }

    /// Bir kez bile denenmemiş mi? `attempt == 0` ile `failed` birlikteyse
    /// sorun gönderimde değil üretimde.
    var wasAttempted: Bool { attempt > 0 }
}

/// ``MessageLogStore``'un tuttuğu süzgeç. `GET /messages` sorgu parametreleriyle
/// birebir; hepsi opsiyonel ve `nil` "süzme" demek.
nonisolated struct MessageFilter: Sendable, Equatable {
    var customerId: String?
    var channel: NotificationChannel?
    var event: NotificationEvent?
    var status: MessageStatus?
    /// ISO-8601; sunucu `IsISO8601` bekliyor.
    var from: String?
    var to: String?

    static let none = MessageFilter()

    var isActive: Bool { self != .none }

    /// Yalnız bir müşterinin geçmişi — müşteri kartından açılan liste.
    static func customer(_ id: String) -> MessageFilter {
        MessageFilter(customerId: id)
    }
}
