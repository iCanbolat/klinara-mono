import SwiftUI

/// Katalog verisinin oturum ömrü boyunca yaşayan tek kopyası.
///
/// Hizmet listesi üç ayrı yerde gerekiyor: hizmet ekranı, kategori ekranı ve
/// **personel yetkinlik matrisi**. Her ekranın kendi kopyasını çekmesi hem
/// gereksiz istek hem de tutarsızlık üretir — matriste yeni eklenen bir hizmet
/// görünmezdi. Yazma işlemleri sonucu doğrudan buraya işlenir, liste yeniden
/// çekilmez: sunucu zaten güncel kaydı döndürüyor.
@MainActor
@Observable
final class CatalogStore {

    struct Catalog: Sendable, Equatable {
        var categories: [ServiceCategory]
        var services: [ClinicService]

        var isEmpty: Bool { categories.isEmpty && services.isEmpty }

        func category(id: String) -> ServiceCategory? {
            categories.first { $0.id == id }
        }

        /// Kategori sırasına göre gruplanmış hizmetler. Kategorisi silinmiş
        /// (pasife alınmış) hizmetler kaybolmaz, sona düşer.
        func grouped(_ visible: [ClinicService]) -> [(category: ServiceCategory?, services: [ClinicService])] {
            let ordered = categories.sorted { $0.sortOrder < $1.sortOrder }
            var groups = ordered.map { category in
                (category: Optional(category), services: visible.filter { $0.categoryId == category.id })
            }
            let known = Set(ordered.map(\.id))
            let orphans = visible.filter { !known.contains($0.categoryId) }
            if !orphans.isEmpty { groups.append((category: nil, services: orphans)) }
            return groups.filter { !$0.services.isEmpty }
        }
    }

    private let service: any CatalogService

    private(set) var state: LoadState<Catalog> = .loading
    /// Kaydetme sırasında oluşan hata — liste durumunu bozmaz, form gösterir.
    private(set) var isSaving = false

    init(service: any CatalogService) {
        self.service = service
    }

    var catalog: Catalog { state.value ?? Catalog(categories: [], services: []) }

    // MARK: Okuma

    func load(force: Bool = false) async {
        if !force, state.value != nil { return }
        state = .loading
        do {
            // İki uç birbirinden bağımsız; sırayla beklemek ekranı iki kat
            // yavaşlatırdı.
            async let categories = service.categories()
            async let services = service.services()
            state = .loaded(Catalog(categories: try await categories, services: try await services))
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func reload() async { await load(force: true) }

    // MARK: Yazma
    //
    // Hepsi aynı deseni izler: sunucudan dönen kaydı yerel kopyaya işle, hatayı
    // çağırana FIRLAT. Formun hatayı kendi alanlarının altında göstermesi
    // gerekiyor; store'un hatayı yutup listede göstermesi işe yaramazdı.

    func createCategory(_ input: CreateServiceCategoryInput) async throws -> ServiceCategory {
        try await mutating {
            let created = try await service.createCategory(input)
            apply { $0.categories.append(created) }
            return created
        }
    }

    func updateCategory(
        id: String,
        _ input: UpdateServiceCategoryInput
    ) async throws -> ServiceCategory {
        try await mutating {
            let updated = try await service.updateCategory(id: id, input)
            apply { catalog in
                if let index = catalog.categories.firstIndex(where: { $0.id == id }) {
                    catalog.categories[index] = updated
                }
            }
            return updated
        }
    }

    func deactivateCategory(id: String) async throws {
        _ = try await mutating {
            let updated = try await service.deactivateCategory(id: id)
            apply { catalog in
                if let index = catalog.categories.firstIndex(where: { $0.id == id }) {
                    catalog.categories[index] = updated
                }
            }
            return updated
        }
    }

    func createService(_ input: CreateServiceInput) async throws -> ClinicService {
        try await mutating {
            let created = try await service.createService(input)
            apply { $0.services.append(created) }
            return created
        }
    }

    func updateService(id: String, _ input: UpdateServiceInput) async throws -> ClinicService {
        try await mutating {
            let updated = try await service.updateService(id: id, input)
            apply { catalog in
                if let index = catalog.services.firstIndex(where: { $0.id == id }) {
                    catalog.services[index] = updated
                }
            }
            return updated
        }
    }

    func deactivateService(id: String) async throws {
        _ = try await mutating {
            let updated = try await service.deactivateService(id: id)
            apply { catalog in
                if let index = catalog.services.firstIndex(where: { $0.id == id }) {
                    catalog.services[index] = updated
                }
            }
            return updated
        }
    }

    // MARK: Yardımcılar

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }

    private func apply(_ change: (inout Catalog) -> Void) {
        var updated = catalog
        change(&updated)
        state = .loaded(updated)
    }
}
