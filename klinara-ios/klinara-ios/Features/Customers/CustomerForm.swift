import Foundation

/// Müşteri formunun durumu — ``ServiceForm`` kalıbı.
///
/// Oluşturma ve güncelleme gövdeleri farklı (`PATCH`'te `null` = temizle),
/// kullanıcıya görünen alanlar aynı. Dönüşüm iki ayrı kurucuda toplanıyor ki
/// ekran hangi uca yazdığını düşünmek zorunda kalmasın.
struct CustomerForm: Equatable {

    var fullName: String
    /// E.164 ya da boş — ``PhoneNumberField`` yarım numara vermez.
    var phone: String
    var email: String
    var hasBirthDate: Bool
    var birthDate: Date
    var gender: CustomerGender?
    var notes: String

    private let original: Snapshot

    private struct Snapshot: Equatable {
        var fullName: String
        var phone: String
        var email: String
        var birthDate: String?
        var gender: CustomerGender?
        var notes: String
    }

    private var current: Snapshot {
        Snapshot(
            fullName: trimmed(fullName),
            phone: phone,
            email: trimmed(email),
            birthDate: birthDateString,
            gender: gender,
            notes: trimmed(notes)
        )
    }

    init(existing: Customer?, clock: BranchClock) {
        fullName = existing?.fullName ?? ""
        phone = existing?.phone ?? ""
        email = existing?.email ?? ""
        let parsed = existing?.birthDate.flatMap(clock.date(fromLocalDateString:))
        hasBirthDate = parsed != nil
        // Varsayılan 30 yıl öncesi: doğum tarihi seçicisinin bugünden başlaması
        // kullanıcıyı otuz yıl geriye kaydırmaya zorlardı.
        birthDate = parsed ?? clock.adding(days: -365 * 30, to: clock.startOfDay(Date()))
        gender = existing?.gender
        notes = existing?.notes ?? ""

        original = Snapshot(
            fullName: existing?.fullName ?? "",
            phone: existing?.phone ?? "",
            email: existing?.email ?? "",
            birthDate: existing?.birthDate,
            gender: existing?.gender,
            notes: existing?.notes ?? ""
        )
    }

    var isDirty: Bool { current != original }

    var isValid: Bool { !trimmed(fullName).isEmpty }

    /// Sunucu e-postayı doğruluyor; formu göndermeden önce söylemek daha hızlı.
    var emailValidationMessage: String? {
        let value = trimmed(email)
        guard !value.isEmpty else { return nil }
        return value.contains("@") && value.contains(".") ? nil : "Geçerli bir e-posta girin."
    }

    private var birthDateString: String? {
        guard hasBirthDate else { return nil }
        let parts = Calendar(identifier: .gregorian).dateComponents(
            [.year, .month, .day],
            from: birthDate
        )
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func nilIfEmpty(_ value: String) -> String? {
        let result = trimmed(value)
        return result.isEmpty ? nil : result
    }

    func createInput() -> CreateCustomerInput {
        CreateCustomerInput(
            fullName: trimmed(fullName),
            phone: nilIfEmpty(phone),
            email: nilIfEmpty(email),
            birthDate: birthDateString,
            gender: gender,
            notes: nilIfEmpty(notes)
        )
    }

    /// Boşaltılan alanlar `null` gider — sunucu bunu "temizle" olarak okur.
    func updateInput() -> UpdateCustomerInput {
        UpdateCustomerInput(
            fullName: trimmed(fullName),
            phone: Nullable.text(phone),
            email: Nullable.text(email),
            birthDate: birthDateString.map { Nullable.set($0) } ?? .clear,
            gender: gender,
            notes: Nullable.text(notes)
        )
    }
}
