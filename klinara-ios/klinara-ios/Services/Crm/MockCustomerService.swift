import Foundation

/// Bellekte yaşayan müşteri servisi — Preview'lar ve geliştirici senaryoları.
///
/// Sunucunun **davranışını** taklit eder, sadece veri döndürmez: telefon E.164'e
/// normalize edilir, kiracı içinde tekildir, arşivleme numarayı serbest
/// bırakır, `PATCH`'te `null` ile "alan gönderilmedi" ayrımı korunur, arama
/// sunucudaki katlamayla aynı cevabı verir ve birleştirme veri kazandırır.
/// Mock'ta geçen bir akışın canlıda patlaması, mock'un hiç olmamasından kötüdür.
final class MockCustomerService: CustomerService, @unchecked Sendable {

    private let lock = NSLock()
    private var records: [Customer]
    private var tagRecords: [CustomerTag]
    /// `customerId → tagId` — sunucudaki `customer_tag_assignments`.
    private var assignments: [String: Set<String>]

    init(scenario: MockDataScenario = .busyDay) {
        records = MockCustomerSeed.customers(at: Date(), scenario: scenario)
        tagRecords = MockCustomerSeed.tags
        assignments = MockCustomerSeed.assignments(scenario: scenario)
        records = Self.applyTags(to: records, tags: tagRecords, assignments: assignments)
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
        withLock {
            records = MockCustomerSeed.customers(at: Date(), scenario: scenario)
            tagRecords = MockCustomerSeed.tags
            assignments = MockCustomerSeed.assignments(scenario: scenario)
            records = Self.applyTags(to: records, tags: tagRecords, assignments: assignments)
        }
    }

    // MARK: Okuma

    /// Sunucudaki `(created_at, id)` cursor'unun aynısı: sıralama anahtarı
    /// gövdede taşınıyor, ofset sayılmıyor. Araya yeni kayıt girdiğinde
    /// ofsetle sayfalamak bir kaydı iki kez göstermek olurdu.
    func customers(
        cursor: String?,
        limit: Int?,
        tagId: String?,
        source: CustomerSource?
    ) async throws -> Page<Customer> {
        await latency(0.3)
        let size = min(limit ?? 50, 200)

        return try withLock {
            var visible = records.sorted {
                ($0.createdAt, $0.id) > ($1.createdAt, $1.id)
            }
            if let tagId { visible = visible.filter { $0.tags.contains { $0.id == tagId } } }
            if let source { visible = visible.filter { $0.source == source } }

            if let cursor {
                guard let key = MockCursor.decode(cursor) else {
                    throw MockErrors.validation("Geçersiz cursor", path: "cursor")
                }
                visible = visible.filter { ($0.createdAt, $0.id) < (key.createdAt, key.id) }
            }

            let page = Array(visible.prefix(size))
            let hasMore = visible.count > size
            let next = hasMore ? page.last.map { MockCursor.encode($0) } : nil
            return Page(data: page, pageInfo: PageInfo(nextCursor: next, hasMore: hasMore))
        }
    }

    /// Sunucudaki `search_text` (ad + telefon, tek indeks) davranışı:
    /// ad katlanmış karşılaştırılır, telefon rakama indirgenir.
    func search(_ term: String, limit: Int?) async throws -> [Customer] {
        await latency(0.2)
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            throw MockErrors.validation("Arama terimi en az 2 karakter olmalı", path: "q")
        }
        let size = min(limit ?? 20, 50)
        return withLock {
            records
                .filter { $0.matches(trimmed) }
                .sorted { ($0.createdAt, $0.id) > ($1.createdAt, $1.id) }
                .prefix(size)
                .map { $0 }
        }
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
                addressLine: input.addressLine,
                district: input.district,
                city: input.city,
                postalCode: input.postalCode,
                source: input.source,
                mergedIntoCustomerId: nil,
                tags: [],
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
                addressLine: resolve(input.addressLine, current: old.addressLine),
                district: resolve(input.district, current: old.district),
                city: resolve(input.city, current: old.city),
                postalCode: resolve(input.postalCode, current: old.postalCode),
                source: resolve(input.source, current: old.source),
                mergedIntoCustomerId: old.mergedIntoCustomerId,
                tags: old.tags,
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
            assignments[id] = nil
            return records.remove(at: index)
        }
    }

    func replaceTags(customerId: String, tagIds: [String]) async throws -> Customer {
        await latency(0.3)
        return try withLock {
            guard records.contains(where: { $0.id == customerId }) else { throw MockErrors.notFound }
            let known = Set(tagRecords.map(\.id))
            guard Set(tagIds).isSubset(of: known) else { throw MockErrors.notFound }
            assignments[customerId] = Set(tagIds)
            records = Self.applyTags(to: records, tags: tagRecords, assignments: assignments)
            return records.first { $0.id == customerId }!
        }
    }

    /// Birleştirme veri **kazanmaktır** (Ek G): hedefin dolu alanı ezilmez,
    /// boş alanı kaynaktan dolar, notlar birleşir, etiketler toplanır, kaynak
    /// arşivlenip hayatta kalana işaret eder.
    func merge(into targetId: String, sourceId: String) async throws -> CustomerMergeResult {
        await latency(0.6)
        return try withLock {
            guard sourceId != targetId else {
                throw MockErrors.validation("Bir kayıt kendisiyle birleştirilemez")
            }
            guard let targetIndex = records.firstIndex(where: { $0.id == targetId }),
                  let sourceIndex = records.firstIndex(where: { $0.id == sourceId })
            else { throw MockErrors.notFound }

            let target = records[targetIndex]
            let source = records[sourceIndex]

            let mergedTags = Set(target.tags.map(\.id)).union(source.tags.map(\.id))
            assignments[targetId] = mergedTags
            assignments[sourceId] = nil

            let merged = Customer(
                id: target.id,
                tenantId: target.tenantId,
                fullName: target.fullName,
                phone: target.phone ?? source.phone,
                email: target.email ?? source.email,
                birthDate: target.birthDate ?? source.birthDate,
                gender: target.gender ?? source.gender,
                notes: Self.mergeNotes(target.notes, source.notes),
                addressLine: target.addressLine ?? source.addressLine,
                district: target.district ?? source.district,
                city: target.city ?? source.city,
                postalCode: target.postalCode ?? source.postalCode,
                source: target.source ?? source.source,
                mergedIntoCustomerId: nil,
                tags: target.tags,
                createdAt: target.createdAt
            )
            records[targetIndex] = merged
            records.remove(at: sourceIndex)
            records = Self.applyTags(to: records, tags: tagRecords, assignments: assignments)

            return CustomerMergeResult(
                id: MockIDs.uuid(),
                sourceCustomerId: sourceId,
                targetCustomerId: targetId,
                moved: [
                    "appointments": 0,
                    "customer_tag_assignments": mergedTags.subtracting(target.tags.map(\.id)).count,
                ],
                customer: records.first { $0.id == targetId }!
            )
        }
    }

    // MARK: Etiketler

    func tags() async throws -> [CustomerTag] {
        await latency(0.2)
        return withLock { tagRecords.sorted { SearchText.fold($0.name) < SearchText.fold($1.name) } }
    }

    func createTag(_ input: CustomerTagInput) async throws -> CustomerTag {
        await latency(0.3)
        return try withLock {
            let name = input.name.trimmingCharacters(in: .whitespacesAndNewlines)
            try assertTagNameFree(name, excluding: nil)
            let tag = CustomerTag(id: MockIDs.uuid(), name: name, color: input.color)
            tagRecords.append(tag)
            return tag
        }
    }

    func updateTag(id: String, _ input: CustomerTagInput) async throws -> CustomerTag {
        await latency(0.3)
        return try withLock {
            guard let index = tagRecords.firstIndex(where: { $0.id == id }) else {
                throw MockErrors.notFound
            }
            let name = input.name.trimmingCharacters(in: .whitespacesAndNewlines)
            try assertTagNameFree(name, excluding: id)
            let tag = CustomerTag(id: id, name: name, color: input.color)
            tagRecords[index] = tag
            records = Self.applyTags(to: records, tags: tagRecords, assignments: assignments)
            return tag
        }
    }

    func deleteTag(id: String) async throws {
        await latency(0.3)
        try withLock {
            guard let index = tagRecords.firstIndex(where: { $0.id == id }) else {
                throw MockErrors.notFound
            }
            tagRecords.remove(at: index)
            for key in assignments.keys { assignments[key]?.remove(id) }
            records = Self.applyTags(to: records, tags: tagRecords, assignments: assignments)
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

    /// Tekillik KATLANMIŞ ada göre: "VIP", "Vip" ve "vıp" aynı etiket (Ek G).
    private func assertTagNameFree(_ name: String, excluding id: String?) throws {
        let folded = SearchText.fold(name)
        let taken = tagRecords.contains { SearchText.fold($0.name) == folded && $0.id != id }
        if taken { throw MockErrors.duplicateTag }
    }

    private static func mergeNotes(_ target: String?, _ source: String?) -> String? {
        switch (target, source) {
        case (let t?, let s?) where t != s: return "\(t)\n\n\(s)"
        case (let t?, _): return t
        case (nil, let s?): return s
        default: return nil
        }
    }

    /// Etiket atamalarını kayıtlara yansıtır — sunucu `tags` alanını yanıt
    /// kurarken dolduruyor, burada da aynı an.
    private static func applyTags(
        to records: [Customer],
        tags: [CustomerTag],
        assignments: [String: Set<String>]
    ) -> [Customer] {
        let byId = Dictionary(uniqueKeysWithValues: tags.map { ($0.id, $0) })
        return records.map { record in
            let assigned = (assignments[record.id] ?? [])
                .compactMap { byId[$0] }
                .sorted { SearchText.fold($0.name) < SearchText.fold($1.name) }
            return Customer(
                id: record.id,
                tenantId: record.tenantId,
                fullName: record.fullName,
                phone: record.phone,
                email: record.email,
                birthDate: record.birthDate,
                gender: record.gender,
                notes: record.notes,
                addressLine: record.addressLine,
                district: record.district,
                city: record.city,
                postalCode: record.postalCode,
                source: record.source,
                mergedIntoCustomerId: record.mergedIntoCustomerId,
                tags: assigned,
                createdAt: record.createdAt
            )
        }
    }
}

// MARK: - Cursor

/// Mock'un opak cursor'u. Sunucu base64'lü bir JSON taşıyor; biçim istemciyi
/// ilgilendirmiyor, **çözülebilir olmaması** ilgilendiriyor — bu yüzden burada
/// da opak bir metin üretiliyor, ham tarih değil.
enum MockCursor {

    static func encode(_ customer: Customer) -> String {
        let raw = "\(customer.createdAt.timeIntervalSince1970)|\(customer.id)"
        return Data(raw.utf8).base64EncodedString()
    }

    static func decode(_ cursor: String) -> (createdAt: Date, id: String)? {
        guard let data = Data(base64Encoded: cursor),
              let raw = String(data: data, encoding: .utf8)
        else { return nil }
        let parts = raw.split(separator: "|", maxSplits: 1)
        guard parts.count == 2, let seconds = TimeInterval(parts[0]) else { return nil }
        return (Date(timeIntervalSince1970: seconds), String(parts[1]))
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

    static var duplicateTag: APIError {
        .problem(ProblemDetails(
            code: .conflict,
            title: "Bu adda bir etiket zaten var",
            detail: "Etiket adları büyük/küçük harf ve Türkçe karakter farkı gözetmeden tekildir.",
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

    static let tagVip = "c2000000-0000-4000-8000-000000000001"
    static let tagSensitive = "c2000000-0000-4000-8000-000000000002"
    static let tagCampaign = "c2000000-0000-4000-8000-000000000003"

    static let tags = [
        CustomerTag(id: tagVip, name: "VIP", color: "#c0392b"),
        CustomerTag(id: tagSensitive, name: "Hassas cilt", color: "#8e7cc3"),
        CustomerTag(id: tagCampaign, name: "Kampanya", color: "#2e8b57"),
    ]

    static func assignments(scenario: MockDataScenario) -> [String: Set<String>] {
        guard scenario != .emptyDay else { return [ayse: [tagVip]] }
        return [
            ayse: [tagVip, tagCampaign],
            zeynep: [tagSensitive],
        ]
    }

    static func customers(at now: Date, scenario: MockDataScenario) -> [Customer] {
        var records = [
            customer(
                id: ayse,
                name: "Ayşe Yılmaz",
                phone: "+905321112233",
                email: "ayse@ornek.test",
                birthDate: "1990-05-12",
                gender: .female,
                addressLine: "Bağdat Cad. No: 120 D: 5",
                district: "Kadıköy",
                city: "İstanbul",
                postalCode: "34710",
                source: .instagram,
                createdAt: now.addingTimeInterval(-86_400 * 40)
            ),
            customer(
                id: mehmet,
                name: "Mehmet Demir",
                phone: "+905324445566",
                email: nil,
                source: .walkIn,
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
                district: "Beşiktaş",
                city: "İstanbul",
                source: .referral,
                createdAt: now.addingTimeInterval(-86_400 * 10)
            ),
            customer(
                id: burak,
                name: "Burak Şahin",
                phone: nil,
                email: "burak@ornek.test",
                gender: .male,
                source: .google,
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
        addressLine: String? = nil,
        district: String? = nil,
        city: String? = nil,
        postalCode: String? = nil,
        source: CustomerSource? = nil,
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
            addressLine: addressLine,
            district: district,
            city: city,
            postalCode: postalCode,
            source: source,
            mergedIntoCustomerId: nil,
            tags: [],
            createdAt: createdAt
        )
    }
}
