import Foundation

// Kaynak: `apps/api/src/modules/notifications/dto/reminder.dto.ts`.
//
// Ek M kararı: hatırlatma randevunun **kendi transaction'ında** planlanıyor ve
// randevu değiştiğinde kuyruktaki iş iptal edilmiyor — iş zamanı gelince
// koşuyor, satırı `pending` bulamıyor ve sessizce çıkıyor. Ekranın `cancelled`
// ve `superseded` satırlarını da göstermesinin sebebi bu: "randevu ertelendi,
// eski hatırlatma ne oldu" sorusunun cevabı orada duruyor.

nonisolated enum ScheduledNotificationStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case pending
    case sent
    case cancelled
    case superseded
    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ScheduledNotificationStatus(rawValue: raw) ?? .unknown
    }

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .pending: return "Planlandı"
        case .sent: return "Gönderildi"
        case .cancelled: return "İptal edildi"
        case .superseded: return "Yenisiyle değişti"
        case .unknown: return "Bilinmiyor"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .sent: return .positive
        case .pending: return .neutral
        case .cancelled, .superseded, .unknown: return .muted
        }
    }
}

/// `BranchReminderSettingsDto` — **çözülmüş** ayar.
///
/// `reminderHoursBefore` şubenin kendi listesi değil, *geçerli* listedir: şube
/// override'ı varsa o, yoksa kiracı ayarı. Hangisi olduğunu `isBranchOverride`
/// söyler; ekran bunu göstermezse kullanıcı kiracı varsayılanını şubeye özel
/// sanıp bir şubede değiştirdiğini hepsinde değiştirir.
nonisolated struct BranchReminderSettings: Decodable, Sendable, Equatable {
    let branchId: String
    /// Randevudan kaç saat önce hatırlatılacağı. Varsayılan `[24, 2]`.
    let reminderHoursBefore: [Int]
    let isBranchOverride: Bool
    let noShowFollowupEnabled: Bool
    let noShowFollowupDelayHours: Int

    var hoursLabel: String {
        guard !reminderHoursBefore.isEmpty else { return "Hatırlatma yok" }
        return reminderHoursBefore
            .sorted(by: >)
            .map { "\($0) saat önce" }
            .joined(separator: ", ")
    }
}

/// `UpdateBranchReminderSettingsDto` — sunucu kısmi birleştirme yapıyor, bu
/// yüzden hepsi opsiyonel. `reminderHoursBefore: []` **override'ı kaldırır** ve
/// şubeyi kiracı varsayılanına döndürür; "hiç hatırlatma gönderme" demek değildir.
nonisolated struct UpdateBranchReminderSettingsInput: Encodable, Sendable, Equatable {
    var reminderHoursBefore: [Int]?
    var noShowFollowupEnabled: Bool?
    var noShowFollowupDelayHours: Int?

    /// Sunucu doğrulaması: en çok 5 saat, her biri 1–720.
    static let maxReminderCount = 5
    static let hourRange = 1...720
    /// `noShowFollowupDelayHours` sınırı.
    static let followupDelayRange = 0...168
}

/// `ScheduledNotificationDto` — bir randevunun bildirim çizelgesi.
nonisolated struct ScheduledNotification: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let event: NotificationEvent
    /// Randevudan kaç saat **önce**. Gelmedi takibinde negatif: randevudan sonra.
    let offsetHours: Int
    let scheduledFor: Date
    let status: ScheduledNotificationStatus
    /// Gönderildiyse ``Message`` kimliği. Sunucu alanı `messageId` diyor,
    /// kolonu `message_log_id`.
    let messageId: String?

    var isFollowup: Bool { offsetHours < 0 }

    var offsetLabel: String {
        if isFollowup {
            return "Randevudan \(abs(offsetHours)) saat sonra"
        }
        return "Randevudan \(offsetHours) saat önce"
    }
}
