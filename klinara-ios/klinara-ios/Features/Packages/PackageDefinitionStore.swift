import SwiftUI

/// Paket tanımlarının oturum ömrü boyunca yaşayan tek kopyası.
///
/// Liste iki yerde gerekiyor: yönetimdeki tanım ekranı ve müşteri kartındaki
/// **satış sayfası**. Satış akışının kendi kopyasını çekmesi, az önce
/// oluşturulan paketin satış listesinde görünmemesi demekti.
///
/// Yazma işlemleri sonucu doğrudan buraya işlenir, liste yeniden çekilmez:
/// sunucu güncel kaydı zaten döndürüyor.
@MainActor
@Observable
final class PackageDefinitionStore {

    private let service: any PackagesService

    private(set) var state: LoadState<[PackageDefinition]> = .loading
    private(set) var isSaving = false
    private(set) var isLoadingMore = false
    private(set) var nextCursor: String?

    init(service: any PackagesService) {
        self.service = service
    }

    var definitions: [PackageDefinition] { state.value ?? [] }

    /// Satılabilir olanlar — satış sayfası bu listeden seçtirir. Arşivlenmiş
    /// ve pasif tanımlar satılamaz; sunucu da reddeder.
    func sellable(in branchId: String?) -> [PackageDefinition] {
        definitions.filter { definition in
            guard definition.isActive, !definition.isArchived else { return false }
            // `branchId == nil` **tüm şubeler** demek, "şubesiz" değil.
            guard let scope = definition.branchId else { return true }
            return scope == branchId
        }
    }

    func definition(id: String) -> PackageDefinition? {
        definitions.first { $0.id == id }
    }

    // MARK: Okuma

    func load(force: Bool = false) async {
        if !force, state.value != nil { return }
        state = .loading
        nextCursor = nil
        do {
            let page = try await service.definitions(
                cursor: nil,
                limit: nil,
                branchId: nil,
                serviceId: nil,
                isActive: nil
            )
            state = .loaded(page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func reload() async { await load(force: true) }

    /// Sonraki sayfa. Hata durumunda cursor **korunur**: eldeki listeyi
    /// düşürmek, kullanıcının aşağı kaydırmasını cezalandırmak olurdu.
    func loadMore() async {
        guard !isLoadingMore, let cursor = nextCursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.definitions(
                cursor: cursor,
                limit: nil,
                branchId: nil,
                serviceId: nil,
                isActive: nil
            )
            state = .loaded(definitions + page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            // Sessiz: liste yerinde duruyor, kullanıcı tekrar deneyebilir.
        }
    }

    // MARK: Yazma
    //
    // Hepsi aynı deseni izler: sunucudan dönen kaydı yerel kopyaya işle, hatayı
    // çağırana FIRLAT — form hatayı kendi alanlarının altında gösterecek.

    func create(_ input: CreatePackageDefinitionInput) async throws -> PackageDefinition {
        try await mutating {
            let created = try await service.createDefinition(input)
            apply { $0.insert(created, at: 0) }
            return created
        }
    }

    func update(
        id: String,
        version: Int,
        _ input: UpdatePackageDefinitionInput
    ) async throws -> PackageDefinition {
        try await mutating {
            let updated = try await service.updateDefinition(id: id, version: version, input)
            apply { list in
                if let index = list.firstIndex(where: { $0.id == id }) { list[index] = updated }
            }
            return updated
        }
    }

    /// Satılmamışsa arşivler, satılmışsa yalnız pasife alır. Sunucu gövde
    /// döndürmüyor (`204`), bu yüzden kaydı **yeniden çekiyoruz**: hangisinin
    /// olduğunu yerelde tahmin etmek iki durumu karıştırırdı.
    func retire(id: String, version: Int) async throws {
        _ = try await mutating { () -> Bool in
            try await service.retireDefinition(id: id, version: version)
            let refreshed = try? await service.definition(id: id)
            apply { list in
                guard let index = list.firstIndex(where: { $0.id == id }) else { return }
                if let refreshed, refreshed.deletedAt == nil {
                    list[index] = refreshed
                } else {
                    list.remove(at: index)
                }
            }
            return true
        }
    }

    // MARK: Yardımcılar

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }

    private func apply(_ change: (inout [PackageDefinition]) -> Void) {
        var updated = definitions
        change(&updated)
        state = .loaded(updated)
    }
}
