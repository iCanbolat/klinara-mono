import Foundation

/// Bellekte yaşayan müşteri servisi — Preview'lar ve geliştirici senaryoları.
///
/// Sunucunun **davranışını** taklit eder, sadece veri döndürmez: telefon E.164'e
/// normalize edilir, kiracı içinde tekildir, arşivleme numarayı serbest
/// bırakır ve `PATCH`'te `null` ile "alan gönderilmedi" ayrımı korunur. Mock'ta
/// geçen bir akışın canlıda patlaması, mock'un hiç olmamasından kötüdür.
final class MockCustomerService: CustomerService, @unchecked Sendable {

    private let lock = NSLock()
    private var records: [Customer]

    init(scenario: MockDataScenario = .busyDay) {
        records = MockCustomerSeed.customers(at: Date(), scenario: scenario)
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    /// Diğer mock servislerin tutarlı kimlik kullanabilmesi için.
    var snapshot: [Customer] { withLock { records } }

    /// Geliştirici menüsünden senaryo değiştirildiğinde çağrılır.
    /// Konteyner yeniden kurulmuyor; kurulsaydı çalışan tüm store'lar eski
    /// servis örneklerine bağlı kalırdı.
    func reseed(_ scenario: MockDataScenario) {
        withLock { records = MockCustomerSeed.customers(at: Date(), scenario: scenario) }
    }

    // MARK: Okuma

    func customers() async throws -> [Customer] {
        await latency(0.3)
        return withLock { records.sorted { $0.createdAt > $1.createdAt } }
    }

    func customer(id: String) async throws -> Customer {
        await latency(0.2)
        return try withLock {
            guard let match = records.first(where: { $0.id == id }) else { throw MockErrors.notFound }
            return match
        }
    }

    // MARK: Yazma

    func create(_ input: CreateCustomerInput) async throws -> Customer {
        await latency()
        let phone = try normalized(input.phone)
        return try withLock {
            try assertPhoneFree(phone, excluding: nil)
            let record = Customer(
                id: MockIDs.uuid(),
                tenantId: MockIDs.tenant,
                fullName: input.fullName.trimmingCharacters(in: .whitespacesAndNewlines),
                phone: phone,
                email: input.email,
                birthDate: input.birthDate,
                gender: input.gender,
                notes: input.notes,
                createdAt: Date()
            )
            records.append(record)
            return record
        }
    }

    func update(id: String, _ input: UpdateCustomerInput) async throws -> Customer {
        await latency()
        let phone: Nullable<String>
        switch input.phone {
        case .set(let raw): phone = .set(try normalized(raw) ?? raw)
        case .clear: phone = .clear
        case .unchanged: phone = .unchanged
        }

        return try withLock {
            guard let index = records.firstIndex(where: { $0.id == id }) else {
                throw MockErrors.notFound
            }
            let old = records[index]
            let nextPhone = resolve(phone, current: old.phone)
            try assertPhoneFree(nextPhone, excluding: id)

            let updated = Customer(
                id: old.id,
                tenantId: old.tenantId,
                fullName: input.fullName ?? old.fullName,
                phone: nextPhone,
                email: resolve(input.email, current: old.email),
                birthDate: resolve(input.birthDate, current: old.birthDate),
                gender: input.gender ?? old.gender,
                notes: resolve(input.notes, current: old.notes),
                createdAt: old.createdAt
            )
            records[index] = updated
            return updated
        }
    }

    func archive(id: String) async throws -> Customer {
        await latency()
        return try withLock {
            guard let index = records.firstIndex(where: { $0.id == id }) else {
                // İkinci `DELETE` 404 alır — sunucudaki davranışın aynısı.
                throw MockErrors.notFound
            }
            // Arşivlenen kayıt listeden düşer ve numarası serbest kalır.
            return records.remove(at: index)
        }
    }

    // MARK: Yardımcılar

    private func resolve<Value>(_ value: Nullable<Value>, current: Value?) -> Value? {
        switch value {
        case .unchanged: return current
        case .clear: return nil
        case .set(let inner): return inner
        }
    }

    /// Sunucudaki `common/phone.ts` normalizasyonunun dar bir karşılığı:
    /// yalnız TR numaraları, mock'un ihtiyacı bu kadar.
    private func normalized(_ raw: String?) throws -> String? {
        guard let raw, !raw.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        var digits = raw.filter(\.isNumber)
        if digits.hasPrefix("90") { digits = String(digits.dropFirst(2)) }
        if digits.hasPrefix("0") { digits = String(digits.dropFirst()) }
        guard digits.count == 10 else { throw MockErrors.invalidPhone }
        return "+90\(digits)"
    }

    private func assertPhoneFree(_ phone: String?, excluding id: String?) throws {
        guard let phone else { return }
        let taken = records.contains { $0.phone == phone && $0.id != id }
        if taken { throw MockErrors.duplicatePhone }
    }
}

// MARK: - Hatalar

/// Mock servislerin ortak hata üreteci. Kodlar ve statüler sunucudakiyle aynı;
/// aksi hâlde ekranların hata yolları mock'ta hiç denenmemiş olurdu.
enum MockErrors {

    static var notFound: APIError {
        .problem(ProblemDetails(code: .notFound, title: "Bulunamadı", status: 404))
    }

    static var duplicatePhone: APIError {
        .problem(ProblemDetails(
            code: .conflict,
            title: "Bu telefon numarası başka bir müşteri kartında kayıtlı",
            status: 409
        ))
    }

    static var invalidPhone: APIError {
        .problem(ProblemDetails(
            code: .validationFailed,
            title: "Telefon numarası geçersiz",
            status: 400,
            errors: [FieldError(path: "phone", message: "Geçerli bir telefon numarası girin")]
        ))
    }

    static func forbidden(_ permission: String) -> APIError {
        .problem(ProblemDetails(
            code: .forbidden,
            title: "Yetkiniz yok",
            detail: "Gereken izin: \(permission)",
            status: 403
        ))
    }

    static func validation(_ title: String, path: String? = nil, message: String? = nil) -> APIError {
        .problem(ProblemDetails(
            code: .validationFailed,
            title: title,
            status: 400,
            errors: path.map { [FieldError(path: $0, message: message ?? title)] }
        ))
    }

    // MARK: Takvim

    static func slotConflict(
        conflicts: [SlotConflict],
        suggestions: [SlotSuggestion]
    ) -> APIError {
        .problem(ProblemDetails(
            code: .slotConflict,
            title: "Seçilen saat dolu",
            detail: "Kaynak bu aralıkta başka bir kayıt tarafından tutuluyor.",
            status: 409,
            conflicts: conflicts,
            suggestions: suggestions
        ))
    }

    static var versionConflict: APIError {
        .problem(ProblemDetails(
            code: .versionConflict,
            title: "Kayıt siz düzenlerken değişti",
            status: 409
        ))
    }

    static var idempotencyConflict: APIError {
        .problem(ProblemDetails(
            code: .idempotencyConflict,
            title: "Aynı anahtarla farklı bir istek gönderildi",
            status: 409
        ))
    }

    static func invalidTransition(
        from: AppointmentStatus,
        to: AppointmentStatus
    ) -> APIError {
        .problem(ProblemDetails(
            code: .invalidStatusTransition,
            title: "Geçersiz durum geçişi",
            detail: "\(from.turkishName) durumundan \(to.turkishName) durumuna geçilemez.",
            status: 409
        ))
    }

    static var notFoundService: APIError {
        .problem(ProblemDetails(code: .notFound, title: "Hizmet bulunamadı veya pasif", status: 404))
    }

    static var notFoundStaff: APIError {
        .problem(ProblemDetails(code: .notFound, title: "Personel bulunamadı veya pasif", status: 404))
    }

    static func incompetent(_ staffName: String, _ serviceName: String) -> APIError {
        .problem(ProblemDetails(
            code: .resourceUnavailable,
            title: "Personel bu hizmeti veremiyor",
            detail: "\(staffName), \(serviceName) hizmeti için yetkin değil.",
            status: 422
        ))
    }
}

// MARK: - Seed

/// Sunucudaki `database/seed.ts` müşterilerinin aynısı, üstüne senaryo başına
/// birkaç kayıt. Kimlikler sabit: mock randevular bunlara referans veriyor.
enum MockCustomerSeed {

    static let ayse = "c1000000-0000-4000-8000-000000000001"
    static let mehmet = "c1000000-0000-4000-8000-000000000002"
    static let zeynep = "c1000000-0000-4000-8000-000000000003"
    static let burak = "c1000000-0000-4000-8000-000000000004"

    static func customers(at now: Date, scenario: MockDataScenario) -> [Customer] {
        var records = [
            customer(
                id: ayse,
                name: "Ayşe Yılmaz",
                phone: "+905321112233",
                email: "ayse@ornek.test",
                birthDate: "1990-05-12",
                gender: .female,
                createdAt: now.addingTimeInterval(-86_400 * 40)
            ),
            customer(
                id: mehmet,
                name: "Mehmet Demir",
                phone: "+905324445566",
                email: nil,
                createdAt: now.addingTimeInterval(-86_400 * 25)
            ),
        ]

        guard scenario != .emptyDay else { return records }

        records.append(contentsOf: [
            customer(
                id: zeynep,
                name: "Zeynep Kaya",
                phone: "+905327778899",
                email: "zeynep@ornek.test",
                birthDate: "1985-11-03",
                gender: .female,
                notes: "Cilt hassasiyeti var, düşük enerji tercih ediyor.",
                createdAt: now.addingTimeInterval(-86_400 * 10)
            ),
            customer(
                id: burak,
                name: "Burak Şahin",
                phone: nil,
                email: "burak@ornek.test",
                gender: .male,
                createdAt: now.addingTimeInterval(-86_400 * 2)
            ),
        ])
        return records
    }

    private static func customer(
        id: String,
        name: String,
        phone: String?,
        email: String?,
        birthDate: String? = nil,
        gender: CustomerGender? = nil,
        notes: String? = nil,
        createdAt: Date
    ) -> Customer {
        Customer(
            id: id,
            tenantId: MockIDs.tenant,
            fullName: name,
            phone: phone,
            email: email,
            birthDate: birthDate,
            gender: gender,
            notes: notes,
            createdAt: createdAt
        )
    }
}
