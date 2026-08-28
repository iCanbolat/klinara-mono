import Foundation

/// Takvim çekirdeğinin veri tipleri.
///
/// Kaynak: `apps/api/src/modules/booking/dto/appointment.dto.ts`,
/// `calendar.dto.ts` ve `availability.dto.ts`. Alan adları sunucudakiyle
/// **birebir**; `CodingKeys` eşlemesi yok. Bir alan adı değiştiğinde derleyici
/// değil çalışma zamanı konuşsun istemiyoruz.
///
/// **Tarih biçimleri üç ayrı sözleşmedir** ve karıştırılmamalıdır:
/// - `startsAt`/`endsAt`/`from`/`to` → şube offset'li (`…+03:00`), kesirsiz.
/// - `createdAt` ve geçmiş kaydının tüm damgaları → UTC (`…000Z`), kesirli.
/// - `localDay` → çıplak `"2026-09-07"`; ``Date`` **değildir**, ``BranchClock``
///   ile yorumlanır. Cihaz saatiyle çözmek onu yanlış güne sabitlerdi.
/// İlk ikisini ``KlinaraCoding`` çözer, üçüncüsü `String` olarak taşınır.

// MARK: - Durum

/// Randevu durumu — `appointment_status_transitions` tablosunun istemci yüzü.
nonisolated enum AppointmentStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case scheduled
    case confirmed
    case arrived
    case inProgress = "in_progress"
    case completed
    case noShow = "no_show"
    case cancelled

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .scheduled: return "Planlandı"
        case .confirmed: return "Onaylandı"
        case .arrived: return "Geldi"
        case .inProgress: return "İşlemde"
        case .completed: return "Tamamlandı"
        case .noShow: return "Gelmedi"
        case .cancelled: return "İptal"
        }
    }

    /// Durumun rozet tonu. `KlinaraBadge.Tone` dört ton taşır; yedi durumu
    /// dörde indirirken ayrım "işler yolunda / dikkat / bitti / sönük" ekseninde.
    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .scheduled: return .neutral
        case .confirmed, .arrived, .inProgress: return .positive
        case .completed: return .muted
        case .noShow: return .warning
        case .cancelled: return .muted
        }
    }

    /// Sonlanmış durumlar — takvimde slotu işgal etmezler.
    var isTerminal: Bool { self == .noShow || self == .cancelled }

    /// Bu durumdan geçilebilecek durumlar.
    ///
    /// Sunucudaki izinli geçiş tablosunun **aynası**. Amacı yetkiyi zorlamak
    /// değil — son savunma hattı DB trigger'ıdır — kullanıcıya basınca `409`
    /// alacağı bir düğmeyi hiç göstermemek.
    func allowedTransitions(canReopen: Bool) -> [AppointmentStatus] {
        switch self {
        case .scheduled: return [.confirmed, .arrived, .noShow, .cancelled]
        case .confirmed: return [.arrived, .noShow, .cancelled]
        case .arrived: return [.inProgress, .noShow, .cancelled]
        case .inProgress: return [.completed, .cancelled]
        case .completed: return canReopen ? [.inProgress, .cancelled] : []
        case .noShow, .cancelled: return []
        }
    }

    /// Erteleme `completed` durumunu da reddeder — `completed → in_progress`
    /// geçişi meşru olsa bile. Sunucudaki kural bu.
    var canReschedule: Bool {
        switch self {
        case .cancelled, .noShow, .completed: return false
        default: return true
        }
    }
}

nonisolated enum AppointmentOrigin: String, Codable, Sendable {
    case `internal`
    case online

    var turkishName: String {
        switch self {
        case .internal: return "Klinik"
        case .online: return "Online"
        }
    }
}

nonisolated enum AppointmentHistoryAction: String, Codable, Sendable {
    case created
    case rescheduled
    case statusChanged = "status_changed"
    case cancelled
    case updated

    var turkishName: String {
        switch self {
        case .created: return "Oluşturuldu"
        case .rescheduled: return "Ertelendi"
        case .statusChanged: return "Durum değişti"
        case .cancelled: return "İptal edildi"
        case .updated: return "Güncellendi"
        }
    }
}

// MARK: - Randevu (detay ucu)

/// `GET|POST /appointments`, `GET /appointments/:id` yanıtı.
///
/// Liste ucunun döndürdüğü ``CalendarEntry`` ile **kasıtlı olarak ayrı tiptir**:
/// sunucu ikisini farklı serileştiriyor. Tek optional-ağırlıklı tipte
/// birleştirmek, hangi alanın hangi uçtan geldiğini derleyicinin bilmemesi olurdu.
nonisolated struct Appointment: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let branchId: String
    let customerId: String
    let status: AppointmentStatus
    let startsAt: Date
    let endsAt: Date
    let origin: AppointmentOrigin
    let notes: String?
    let cancellationReason: String?
    /// İyimser kilit sürümü. `If-Match` başlığı buradan kurulur.
    let version: Int
    let totalMinor: Int
    let createdAt: Date
    let services: [AppointmentServiceLine]
}

/// Randevunun tek hizmet kalemi. Fiyat, süre ve buffer **randevu anındaki**
/// değerlerdir (snapshot) — katalog sonradan zamlanırsa bu satır değişmez.
nonisolated struct AppointmentServiceLine: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let serviceId: String
    let staffProfileId: String
    let sortOrder: Int
    let startsAt: Date
    let endsAt: Date
    let durationMinutes: Int
    let bufferBeforeMinutes: Int
    let bufferAfterMinutes: Int
    let priceMinor: Int
    let vatRateBasisPoints: Int
    /// Bu kalem bir paketten düşülecekse müşterinin paket kalemi (Faz 5).
    /// Randevu `completed` olduğunda **aynı transaction'da** bir seans düşer.
    let customerPackageItemId: String?

    /// Takvimde işgal edilen süre. `startsAt`/`endsAt` **görünen** aralıktır;
    /// buffer'lar müşteriye gösterilen saati kirletmesin diye ayrı duruyor.
    var occupiedMinutes: Int { bufferBeforeMinutes + durationMinutes + bufferAfterMinutes }
}

/// `GET /appointments/:id/history` kaydı. Tüm damgaları **UTC**.
nonisolated struct AppointmentHistoryEntry: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let action: AppointmentHistoryAction
    let actorUserId: String?
    let fromStatus: AppointmentStatus?
    let toStatus: AppointmentStatus?
    let oldStartsAt: Date?
    let newStartsAt: Date?
    let reason: String?
    let createdAt: Date
}

// MARK: - Takvim (liste ucu)

/// `GET /appointments` ve `GET /calendar/*` içindeki randevu satırı.
///
/// Müşteri adı ve hizmet adları burada **denormalize** gelir; buna karşılık
/// `tenantId`, `origin`, `cancellationReason`, `createdAt`, buffer ve KDV yok.
nonisolated struct CalendarEntry: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let branchId: String
    let customerId: String
    let customerName: String
    let customerPhone: String?
    let status: AppointmentStatus
    let startsAt: Date
    let endsAt: Date
    let notes: String?
    let version: Int
    let totalMinor: Int
    let services: [CalendarEntryServiceLine]

    /// Satırda gösterilecek hizmet özeti: "Tüm Vücut Lazer + Bölgesel Lazer".
    var serviceSummary: String {
        services.sorted { $0.sortOrder < $1.sortOrder }
            .map(\.serviceName)
            .joined(separator: " + ")
    }

    /// Bu randevuda kalemi olan personel kimlikleri (tekrarsız, sıra korunur).
    var staffProfileIds: [String] {
        var seen = Set<String>()
        return services.sorted { $0.sortOrder < $1.sortOrder }
            .compactMap { seen.insert($0.staffProfileId).inserted ? $0.staffProfileId : nil }
    }
}

nonisolated struct CalendarEntryServiceLine: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let serviceId: String
    let serviceName: String
    let staffProfileId: String
    let sortOrder: Int
    let startsAt: Date
    let endsAt: Date
    let priceMinor: Int
}

/// `GET /calendar/day|week|staff` yanıtı.
nonisolated struct CalendarResponse: Codable, Sendable, Equatable {
    let branchId: String
    let timezone: String
    let from: Date
    let to: Date
    let appointments: [CalendarEntry]
    let density: [DensityBucket]
}

/// Yoğunluk ısı haritasının tek kovası. `localDay` çıplak tarih metnidir.
nonisolated struct DensityBucket: Codable, Sendable, Equatable, Identifiable {
    let localDay: String
    let localHour: Int
    let appointmentCount: Int

    var id: String { "\(localDay)#\(localHour)" }
}

// MARK: - Uygunluk

/// `GET /availability` yanıtı.
nonisolated struct AvailabilityResponse: Codable, Sendable, Equatable {
    let branchId: String
    let timezone: String
    let slotGranularityMinutes: Int
    let slots: [AvailabilitySlot]
}

nonisolated struct AvailabilitySlot: Codable, Sendable, Hashable, Identifiable {
    let startsAt: Date
    let endsAt: Date
    /// Bu slotu karşılayabilen **aday** personel kümesi. Boş gelmez.
    let staffProfileIds: [String]

    var id: Date { startsAt }

    func supports(staffProfileId: String?) -> Bool {
        guard let staffProfileId else { return true }
        return staffProfileIds.contains(staffProfileId)
    }
}

// MARK: - Çakışma ayrıntıları

/// `409 SLOT_CONFLICT` gövdesindeki dolu kaynak.
///
/// **Dikkat:** `from`/`to` burada UTC'dir ve **buffer dahil** işgal aralığını
/// gösterir — müşterinin gördüğü saat değil. Aynı gövdedeki
/// ``SlotSuggestion`` ise şube offset'li yazılır; iki alan bilerek farklı.
nonisolated struct SlotConflict: Decodable, Sendable, Equatable, Identifiable {
    let resourceType: String
    let resourceId: String
    /// Bloğun sahibi randevu. Bir "hold" kaydından geliyorsa `nil`.
    let appointmentId: String?
    let from: Date
    let to: Date

    var id: String { "\(resourceId)#\(from.timeIntervalSince1970)" }
}

/// Sunucunun sunduğu alternatif slot. En fazla üç tane gelir.
nonisolated struct SlotSuggestion: Decodable, Sendable, Equatable, Identifiable {
    let startsAt: Date
    let endsAt: Date
    let staffProfileIds: [String]

    var id: Date { startsAt }
}

// MARK: - İstekler

nonisolated struct AppointmentServiceInput: Encodable, Sendable, Equatable {
    let serviceId: String
    let staffProfileId: String
    /// Doluysa hizmet bu paket kaleminden düşer. Randevu oluştururken
    /// verilebilir; sonradan bağlamak için `POST /appointments/:id/consume-package`.
    var customerPackageItemId: String?
}

nonisolated struct CreateAppointmentInput: Encodable, Sendable, Equatable {
    let branchId: String
    let customerId: String
    /// ISO 8601 + offset, **şube saat diliminde** kurulur — bkz. ``BranchClock/wireValue(_:)``.
    let startsAt: String
    /// Sıra anlamlıdır: hizmetler gönderilen sırayla ardışık uygulanır.
    let services: [AppointmentServiceInput]
    var notes: String?
}

/// `PATCH /appointments/:id` — **yalnız not** günceller.
///
/// `notes` opsiyonel değil: sunucu gövdeden düşen alanı `null` sayıp notu
/// **siler**. Zorunlu tutmak bu tuzağı çağrı yerinde kapatıyor.
nonisolated struct UpdateAppointmentInput: Encodable, Sendable, Equatable {
    let notes: String?
}

nonisolated struct RescheduleAppointmentInput: Encodable, Sendable, Equatable {
    let startsAt: String
    /// Verilmezse mevcut hizmet ve personel dizilimi korunur.
    var services: [AppointmentServiceInput]?
    var reason: String?
}

nonisolated struct CancelAppointmentInput: Encodable, Sendable, Equatable {
    var reason: String?
}

nonisolated struct ChangeAppointmentStatusInput: Encodable, Sendable, Equatable {
    let status: AppointmentStatus
    var reason: String?
}

// MARK: - Sorgular

nonisolated struct AvailabilityQuery: Sendable, Equatable {
    let branchId: String
    /// Sıra anlamlıdır — ardışık işlem süresi bu sırayla hesaplanır.
    let serviceIds: [String]
    let from: Date
    let to: Date
    var staffProfileId: String?
}

nonisolated struct AppointmentListQuery: Sendable, Equatable {
    var branchId: String?
    let from: Date
    let to: Date
    var customerId: String?
    var staffProfileId: String?
    var status: [AppointmentStatus] = []
    var limit: Int?
    var cursor: String?
}

/// `date` ve `weekStart` **şube yerel tarihi** metnidir (`"2026-09-07"`),
/// an değil. ``BranchClock/localDateString(_:)`` üretir.
nonisolated struct CalendarDayQuery: Sendable, Equatable {
    let branchId: String
    let date: String
    var staffProfileId: String?
}

nonisolated struct CalendarWeekQuery: Sendable, Equatable {
    let branchId: String
    let weekStart: String
    var staffProfileId: String?
}

/// Gün/hafta uçlarının aksine bu uç **an** alır.
nonisolated struct CalendarStaffQuery: Sendable, Equatable {
    let branchId: String
    let staffProfileId: String
    let from: Date
    let to: Date
}
