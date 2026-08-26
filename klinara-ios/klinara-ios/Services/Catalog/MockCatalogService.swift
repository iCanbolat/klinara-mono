import Foundation

/// Sunucu olmadan katalog ekranlarını sürmek için bellek-içi katalog.
///
/// Gerçek servisin **davranışını** taklit eder, yalnız verisini değil:
/// tekrar eden slug `CONFLICT` fırlatır, `deactivate` kaydı silmez pasife alır,
/// güncelleme verilmeyen alanı korur. Arayüz bu davranışlara göre yazıldığı
/// için mock'un onları atlaması, canlıda ilk denemede çıkan hataya dönüşürdü.
final class MockCatalogService: CatalogService, @unchecked Sendable {

    private let lock = NSLock()
    private var _categories: [ServiceCategory]
    private var _services: [ClinicService]

    init() {
        let now = Date()
        _categories = MockCatalogSeed.categories(at: now)
        _services = MockCatalogSeed.services(at: now)
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    private func conflict(_ detail: String) -> APIError {
        .problem(ProblemDetails(code: .conflict, title: "Çakışma", detail: detail, status: 409))
    }

    private func notFound() -> APIError {
        .problem(ProblemDetails(code: .notFound, title: "Bulunamadı", status: 404))
    }

    /// Diğer mock servisler (personel yetkinlik matrisi) aynı hizmet listesini
    /// görmeli — yoksa var olmayan bir hizmete yetkinlik atanmış gibi görünür.
    var snapshotServices: [ClinicService] { withLock { _services } }

    // MARK: - Kategoriler

    func categories() async throws -> [ServiceCategory] {
        await latency(0.3)
        return withLock { _categories.sorted { $0.sortOrder < $1.sortOrder } }
    }

    func createCategory(_ input: CreateServiceCategoryInput) async throws -> ServiceCategory {
        await latency()
        return try withLock {
            guard !_categories.contains(where: { $0.slug == input.slug }) else {
                throw conflict("Bu hizmet kategorisi kodu zaten kullanımda")
            }
            let created = ServiceCategory(
                id: MockIDs.uuid(),
                tenantId: MockIDs.tenant,
                slug: input.slug,
                name: input.name,
                sortOrder: input.sortOrder ?? _categories.count,
                isActive: input.isActive ?? true,
                createdAt: Date()
            )
            _categories.append(created)
            return created
        }
    }

    func updateCategory(
        id: String,
        _ input: UpdateServiceCategoryInput
    ) async throws -> ServiceCategory {
        await latency()
        return try withLock {
            guard let index = _categories.firstIndex(where: { $0.id == id }) else { throw notFound() }
            if let slug = input.slug,
               _categories.contains(where: { $0.slug == slug && $0.id != id }) {
                throw conflict("Bu hizmet kategorisi kodu zaten kullanımda")
            }
            let old = _categories[index]
            let updated = ServiceCategory(
                id: old.id,
                tenantId: old.tenantId,
                slug: input.slug ?? old.slug,
                name: input.name ?? old.name,
                sortOrder: input.sortOrder ?? old.sortOrder,
                isActive: input.isActive ?? old.isActive,
                createdAt: old.createdAt
            )
            _categories[index] = updated
            return updated
        }
    }

    func deactivateCategory(id: String) async throws -> ServiceCategory {
        try await updateCategory(id: id, UpdateServiceCategoryInput(isActive: false))
    }

    // MARK: - Hizmetler

    func services() async throws -> [ClinicService] {
        await latency(0.3)
        return withLock { _services }
    }

    func service(id: String) async throws -> ClinicService {
        await latency(0.2)
        return try withLock {
            guard let found = _services.first(where: { $0.id == id }) else { throw notFound() }
            return found
        }
    }

    func createService(_ input: CreateServiceInput) async throws -> ClinicService {
        await latency()
        return try withLock {
            guard !_services.contains(where: { $0.slug == input.slug }) else {
                throw conflict("Bu hizmet kodu zaten kullanımda")
            }
            guard _categories.contains(where: { $0.id == input.categoryId }) else { throw notFound() }

            let serviceId = MockIDs.uuid()
            let created = ClinicService(
                id: serviceId,
                tenantId: MockIDs.tenant,
                categoryId: input.categoryId,
                slug: input.slug,
                name: input.name,
                description: input.description,
                durationMinutes: input.durationMinutes,
                bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
                bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
                priceMinor: input.priceMinor,
                vatRateBasisPoints: input.vatRateBasisPoints ?? 2000,
                calendarColor: input.calendarColor,
                isOnlineBookable: input.isOnlineBookable ?? true,
                isActive: input.isActive ?? true,
                createdAt: Date(),
                branchOverrides: MockCatalogSeed.overrides(
                    from: input.branchOverrides ?? [],
                    serviceId: serviceId
                )
            )
            _services.append(created)
            return created
        }
    }

    func updateService(id: String, _ input: UpdateServiceInput) async throws -> ClinicService {
        await latency()
        return try withLock {
            guard let index = _services.firstIndex(where: { $0.id == id }) else { throw notFound() }
            if let slug = input.slug, _services.contains(where: { $0.slug == slug && $0.id != id }) {
                throw conflict("Bu hizmet kodu zaten kullanımda")
            }
            let old = _services[index]
            let updated = ClinicService(
                id: old.id,
                tenantId: old.tenantId,
                categoryId: input.categoryId ?? old.categoryId,
                slug: input.slug ?? old.slug,
                name: input.name ?? old.name,
                description: input.description ?? old.description,
                durationMinutes: input.durationMinutes ?? old.durationMinutes,
                bufferBeforeMinutes: input.bufferBeforeMinutes ?? old.bufferBeforeMinutes,
                bufferAfterMinutes: input.bufferAfterMinutes ?? old.bufferAfterMinutes,
                priceMinor: input.priceMinor ?? old.priceMinor,
                vatRateBasisPoints: input.vatRateBasisPoints ?? old.vatRateBasisPoints,
                calendarColor: input.calendarColor ?? old.calendarColor,
                isOnlineBookable: input.isOnlineBookable ?? old.isOnlineBookable,
                isActive: input.isActive ?? old.isActive,
                createdAt: old.createdAt,
                // Sunucu da override listesini TAMAMEN değiştirir; kısmi birleştirme yok.
                branchOverrides: input.branchOverrides.map {
                    MockCatalogSeed.overrides(from: $0, serviceId: old.id)
                } ?? old.branchOverrides
            )
            _services[index] = updated
            return updated
        }
    }

    func deactivateService(id: String) async throws -> ClinicService {
        try await updateService(id: id, UpdateServiceInput(isActive: false))
    }
}
