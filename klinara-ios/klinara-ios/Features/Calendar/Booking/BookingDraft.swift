import Foundation

/// Randevu oluşturma / erteleme formunun durumu.
///
/// ``ServiceForm`` kalıbı: gözlemlenebilir olmayan bir değer tipi, `@State`
/// içinde yaşar, `isValid` ve `isDirty`'yi kendi hesaplar ve wire gövdesini
/// kendi kurar. Görünüm hiçbir alanı sunucu biçimine kendi çevirmez.
struct BookingDraft: Equatable {

    let branchId: String
    /// Erteleme modunda dolu — o zaman müşteri ve hizmet seçimi kilitlidir.
    let rescheduling: Appointment?

    var customerId: String?
    /// **Sıra anlamlıdır**: hizmetler bu sırayla ardışık uygulanır ve toplam
    /// süre buna göre hesaplanır.
    var serviceIds: [String] = []
    /// Tüm hizmetleri uygulayacak personel. MVP sınırı: blok tek personele
    /// verilir, hizmetleri bölmek sunucuda da kapsam dışı.
    var staffProfileId: String?
    var slot: AvailabilitySlot?
    var notes = ""
    var reason = ""

    private let original: Snapshot

    private struct Snapshot: Equatable {
        var customerId: String?
        var serviceIds: [String]
        var staffProfileId: String?
        var slotStart: Date?
        var notes: String
    }

    private var current: Snapshot {
        Snapshot(
            customerId: customerId,
            serviceIds: serviceIds,
            staffProfileId: staffProfileId,
            slotStart: slot?.startsAt,
            notes: notes
        )
    }

    init(branchId: String, rescheduling: Appointment? = nil) {
        self.branchId = branchId
        self.rescheduling = rescheduling
        if let rescheduling {
            customerId = rescheduling.customerId
            let ordered = rescheduling.services.sorted { $0.sortOrder < $1.sortOrder }
            serviceIds = ordered.map(\.serviceId)
            staffProfileId = ordered.first?.staffProfileId
            notes = rescheduling.notes ?? ""
        }
        original = Snapshot(
            customerId: customerId,
            serviceIds: serviceIds,
            staffProfileId: staffProfileId,
            slotStart: nil,
            notes: notes
        )
    }

    var isRescheduling: Bool { rescheduling != nil }

    /// Erteleme yalnız saati değiştirir; müşteri ve hizmet seçimi kapalıdır.
    var canEditLineup: Bool { !isRescheduling }

    var isDirty: Bool { current != original }

    var isValid: Bool {
        customerId != nil && !serviceIds.isEmpty && slot != nil && staffProfileId != nil
    }

    /// Uygunluk sorgusu için yeterli bilgi var mı — slot henüz seçilmemiş olabilir.
    var canQueryAvailability: Bool { !serviceIds.isEmpty }

    // MARK: Seçim

    mutating func toggle(serviceId: String) {
        if let index = serviceIds.firstIndex(of: serviceId) {
            serviceIds.remove(at: index)
        } else {
            serviceIds.append(serviceId)
        }
        // Hizmet kümesi değişince slot süresi de değişir; eski seçim artık
        // geçerli olmayabilir, sessizce taşımaktansa sıfırlamak doğru.
        slot = nil
    }

    mutating func select(staffProfileId id: String?) {
        staffProfileId = id
        slot = nil
    }

    /// Slot seçimi. Aday kümesinde seçili personel yoksa ilk aday alınır —
    /// "herkes olur" durumunda kullanıcıya personel seçtirmeye gerek yok.
    mutating func select(slot picked: AvailabilitySlot) {
        slot = picked
        if let current = staffProfileId, picked.staffProfileIds.contains(current) { return }
        staffProfileId = picked.staffProfileIds.first
    }

    // MARK: Wire gövdeleri

    func createInput(clock: BranchClock) -> CreateAppointmentInput? {
        guard let customerId, let slot, let staffProfileId, !serviceIds.isEmpty else { return nil }
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        return CreateAppointmentInput(
            branchId: branchId,
            customerId: customerId,
            startsAt: clock.wireValue(slot.startsAt),
            services: serviceIds.map {
                AppointmentServiceInput(serviceId: $0, staffProfileId: staffProfileId)
            },
            notes: trimmed.isEmpty ? nil : trimmed
        )
    }

    func rescheduleInput(clock: BranchClock) -> RescheduleAppointmentInput? {
        guard let slot, let staffProfileId else { return nil }
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        return RescheduleAppointmentInput(
            startsAt: clock.wireValue(slot.startsAt),
            services: serviceIds.map {
                AppointmentServiceInput(serviceId: $0, staffProfileId: staffProfileId)
            },
            reason: trimmed.isEmpty ? nil : trimmed
        )
    }

    // MARK: Özet

    /// Seçili hizmetlerin **görünen** toplam süresi.
    func visibleMinutes(services: [ClinicService]) -> Int {
        selected(from: services).reduce(0) { $0 + $1.effective(in: branchId).durationMinutes }
    }

    /// Takvimde işgal edilen toplam süre — hazırlık ve temizlik payı dahil.
    func occupiedMinutes(services: [ClinicService]) -> Int {
        selected(from: services).reduce(0) { $0 + $1.effective(in: branchId).occupiedMinutes }
    }

    func totalMinor(services: [ClinicService]) -> Int {
        selected(from: services).reduce(0) { $0 + $1.effective(in: branchId).priceMinor }
    }

    /// Seçim sırasını koruyarak hizmetleri çözer.
    func selected(from services: [ClinicService]) -> [ClinicService] {
        serviceIds.compactMap { id in services.first { $0.id == id } }
    }

    /// Seçilen hizmetlerin hepsini verebilen personel.
    func eligibleStaff(_ profiles: [StaffProfile]) -> [StaffProfile] {
        guard !serviceIds.isEmpty else { return profiles.filter(\.isActive) }
        return profiles.filter { profile in
            profile.isActive && serviceIds.allSatisfy {
                profile.skill(for: $0, in: branchId) != nil
            }
        }
    }
}
