import Foundation

/// Uygunluk yanıtının ekrana çevrilmesi — saf mantık, görünümden ayrı ki
/// test edilebilsin.
///
/// Web `lib/calendar/availability.ts` ve Android `AvailabilityPresentation`
/// aynı kuralları ve aynı metinleri taşıyor; birinde değişen metin diğer
/// ikisine de işlenmeli.
enum BookingAvailabilityPresentation {

    enum Period: String, CaseIterable, Sendable {
        case morning, afternoon, evening

        var title: String {
            switch self {
            case .morning: "Sabah"
            case .afternoon: "Öğleden sonra"
            case .evening: "Akşam"
            }
        }

        static func of(hour: Int) -> Period {
            if hour < 12 { return .morning }
            if hour < 17 { return .afternoon }
            return .evening
        }
    }

    struct SlotGroup: Identifiable, Equatable {
        let period: Period
        var slots: [AvailabilitySlot]
        var id: Period { period }
    }

    /// Slotları sabah / öğleden sonra / akşam gruplarına böler; sıra korunur,
    /// boş grup dönmez. Saat ŞUBE saat diliminde okunur.
    static func group(_ slots: [AvailabilitySlot], clock: BranchClock) -> [SlotGroup] {
        var groups: [SlotGroup] = []
        for slot in slots {
            let period = Period.of(hour: clock.minutesFromMidnight(slot.startsAt) / 60)
            if groups.last?.period == period {
                groups[groups.count - 1].slots.append(slot)
            } else {
                groups.append(SlotGroup(period: period, slots: [slot]))
            }
        }
        return groups
    }

    struct Notice: Equatable {
        /// `true`: gün kuralı (kapalı, tatil…); `false`: açık ama dolu.
        let isDayRule: Bool
        let title: String
        let detail: String
        /// "Sonraki gün" önerilsin mi — geçmiş/pencere dışında anlamsız.
        let suggestsNextDay: Bool
    }

    /// Slot listesi boşken NEDEN boş olduğu. `day` yoksa (eski API) gün dolu
    /// kabul ediliyor.
    static func emptyNotice(for day: AvailabilityDay?) -> Notice {
        switch day?.status {
        case .holiday:
            return Notice(
                isDayRule: true,
                title: day?.holidayName.map { "Tatil · \($0)" } ?? "Klinik bu gün tatil",
                detail: "Bu gün randevu alınmıyor. Başka bir gün seçin.",
                suggestsNextDay: true
            )
        case .closed:
            return Notice(
                isDayRule: true,
                title: "Şube bu gün kapalı",
                detail: "Haftalık çalışma saatlerinde bu gün kapalı. Başka bir gün seçin.",
                suggestsNextDay: true
            )
        case .past:
            return Notice(
                isDayRule: true,
                title: "Bu günün çalışma saatleri geçti",
                detail: "İleri bir tarih seçin.",
                suggestsNextDay: true
            )
        case .beyondWindow:
            return Notice(
                isDayRule: true,
                title: "Rezervasyon penceresinin dışında",
                detail: "Bu tarih için henüz randevu açılmadı. Daha yakın bir gün seçin.",
                suggestsNextDay: false
            )
        case .open, .unknown, nil:
            return Notice(
                isDayRule: false,
                title: "Bu gün boş saat kalmadı",
                detail: "Tüm saatler dolu. Başka bir gün ya da personel deneyin.",
                suggestsNextDay: true
            )
        }
    }

    /// Açık günün ek notu: yarım gün tatilde daraltılmış saatler.
    static func openDayNote(for day: AvailabilityDay?) -> String? {
        guard let day, day.status == .open, let name = day.holidayName else { return nil }
        if let opens = day.opensAt, let closes = day.closesAt {
            return "\(name) · kısaltılmış çalışma saatleri \(opens)–\(closes)"
        }
        return "\(name) · kısaltılmış çalışma saatleri"
    }
}
