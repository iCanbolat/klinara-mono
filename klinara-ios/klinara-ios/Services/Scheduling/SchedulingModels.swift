import Foundation

// `apps/api/src/modules/scheduling/dto/scheduling.dto.ts` karşılıkları.
//
// DİKKAT — saat alanları: sunucu `openTime` gibi alanları `"09:00:00"` biçiminde
// DÖNDÜRÜR ama `"09:00"` biçiminde BEKLER (`TIME_PATTERN` saniyesizdir).
// Dönüşüm ``ClockTime`` içinde tek yerde yapılır.

/// Haftanın günü — sunucu `0 = Pazar` sayar (PostgreSQL `dow` uyumu).
nonisolated enum Weekday: Int, CaseIterable, Identifiable, Sendable {
    case sunday = 0, monday, tuesday, wednesday, thursday, friday, saturday

    var id: Int { rawValue }

    var turkishName: String {
        switch self {
        case .sunday: "Pazar"
        case .monday: "Pazartesi"
        case .tuesday: "Salı"
        case .wednesday: "Çarşamba"
        case .thursday: "Perşembe"
        case .friday: "Cuma"
        case .saturday: "Cumartesi"
        }
    }

    var shortName: String { String(turkishName.prefix(3)) }

    /// Haftaya pazartesiden başlayan görüntüleme sırası — Türkiye'de takvim
    /// haftası pazartesi başlar, veri modeli ise pazar.
    static let displayOrder: [Weekday] =
        [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday]
}

// MARK: - Şube çalışma saatleri

/// `BranchHourResponseDto`.
nonisolated struct BranchHour: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let branchId: String
    let dayOfWeek: Int
    let isClosed: Bool
    let openTime: String?
    let closeTime: String?
    let breakStartTime: String?
    let breakEndTime: String?
    let createdAt: Date

    var weekday: Weekday { Weekday(rawValue: dayOfWeek) ?? .monday }
}

/// `BranchHoursResponseDto`.
nonisolated struct BranchHours: Codable, Sendable, Equatable {
    let branchId: String
    let entries: [BranchHour]
}

/// `BranchHourInputDto`.
nonisolated struct BranchHourInput: Encodable, Sendable, Equatable {
    let dayOfWeek: Int
    var isClosed: Bool?
    var openTime: String?
    var closeTime: String?
    var breakStartTime: String?
    var breakEndTime: String?
}

/// `PutBranchHoursDto`.
nonisolated struct PutBranchHoursInput: Encodable, Sendable {
    let entries: [BranchHourInput]
}

// MARK: - Personel haftalık şablonu

/// `StaffScheduleResponseDto`.
nonisolated struct StaffScheduleEntry: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let staffProfileId: String
    let branchId: String
    let dayOfWeek: Int
    let isOff: Bool
    let startTime: String?
    let endTime: String?
    let createdAt: Date

    var weekday: Weekday { Weekday(rawValue: dayOfWeek) ?? .monday }
}

/// `StaffScheduleByBranchResponseDto`.
nonisolated struct StaffSchedule: Codable, Sendable, Equatable {
    let staffProfileId: String
    let branchId: String
    let entries: [StaffScheduleEntry]
}

/// `StaffScheduleInputDto`.
nonisolated struct StaffScheduleEntryInput: Encodable, Sendable, Equatable {
    let dayOfWeek: Int
    var isOff: Bool?
    var startTime: String?
    var endTime: String?
}

/// `PutStaffScheduleDto`.
nonisolated struct PutStaffScheduleInput: Encodable, Sendable {
    let branchId: String
    let entries: [StaffScheduleEntryInput]
}

// MARK: - İstisnalar

nonisolated enum ScheduleRecurrence: String, Codable, Sendable, CaseIterable, Identifiable {
    case none
    case weekly

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .none: "Tekrar yok"
        case .weekly: "Haftalık"
        }
    }
}

/// `ScheduleExceptionResponseDto`.
nonisolated struct ScheduleException: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let staffProfileId: String
    let branchId: String
    let startsAt: Date
    let endsAt: Date
    let reason: String?
    let recurrenceType: ScheduleRecurrence
    let recurrenceIntervalWeeks: Int
    let recurrenceUntil: Date?
    let recurrenceWeekdays: [Int]
    let isActive: Bool
    let createdAt: Date
}

/// `ScheduleExceptionInputDto`.
nonisolated struct ScheduleExceptionInput: Encodable, Sendable {
    let staffProfileId: String
    let branchId: String
    /// ISO 8601 + offset. **Şube saat diliminde** kurulur — bkz. ``BranchClock``.
    let startsAt: String
    let endsAt: String
    var reason: String?
    var recurrenceType: ScheduleRecurrence?
    var recurrenceIntervalWeeks: Int?
    var recurrenceUntil: String?
    var recurrenceWeekdays: [Int]?
    var isActive: Bool?
}

/// `ListScheduleExceptionsQueryDto`.
nonisolated struct ScheduleExceptionQuery: Sendable {
    let branchId: String
    var staffProfileId: String?
    var from: Date?
    var to: Date?
}
