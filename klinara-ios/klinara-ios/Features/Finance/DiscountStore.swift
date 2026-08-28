import SwiftUI

/// İndirim tanımları — oturum ömürlü.
///
/// ``PackageDefinitionStore`` ile aynı gerekçe: yönetimdeki indirim ekranı ile
/// kalem açma sheet'indeki seçici **aynı** listeye bakmalı. Ekran başına
/// çekmek, az önce tanımlanan bir indirimin seçicide görünmemesi demekti.
///
/// Uçlar `service:read` / `service:write` ile korunur — indirim bir katalog
/// tanımıdır, günlük tahsilat işlemi değil.
@MainActor
@Observable
final class DiscountStore {

    private let service: any FinanceService

    private(set) var state: LoadState<[Discount]> = .loading
    private(set) var nextCursor: String?
    private(set) var isLoadingMore = false
    private(set) var isSaving = false

    init(service: any FinanceService) {
        self.service = service
    }

    var discounts: [Discount] { state.value ?? [] }

    /// Bir kaleme uygulanabilecek indirimler. Süresi dolmuş ya da hakkı
    /// tükenmiş olanlar seçiciye hiç girmez: sunucu onları `DISCOUNT_INVALID`
    /// ile reddediyor ve kullanıcıyı 409'a göndermek gereksiz.
    func selectable(for serviceId: String? = nil) -> [Discount] {
        discounts.filter { discount in
            guard discount.isSelectable() else { return false }
            switch discount.scope {
            case .all: return true
            case .service: return serviceId == nil || discount.scopeRefId == serviceId
            case .package: return false
            }
        }
    }

    func discount(id: String) -> Discount? {
        discounts.first { $0.id == id }
    }

    // MARK: Okuma

    func load() async {
        guard state.value == nil else { return }
        await reload()
    }

    func reload() async {
        state = .loading
        nextCursor = nil
        do {
            let page = try await service.discounts(cursor: nil, limit: nil, activeOnly: nil)
            state = .loaded(page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.discounts(cursor: cursor, limit: nil, activeOnly: nil)
            state = .loaded(discounts + page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            nextCursor = cursor
        }
    }

    // MARK: Yazma

    func create(_ input: CreateDiscountInput) async throws -> Discount {
        try await mutating {
            let created = try await service.createDiscount(input)
            state = .loaded([created] + discounts)
            return created
        }
    }

    func update(id: String, version: Int, _ input: UpdateDiscountInput) async throws -> Discount {
        try await mutating {
            let updated = try await service.updateDiscount(id: id, version: version, input)
            merge(updated)
            return updated
        }
    }

    func delete(id: String, version: Int) async throws {
        _ = try await mutating {
            try await service.deleteDiscount(id: id, version: version)
            state = .loaded(discounts.filter { $0.id != id })
        }
    }

    private func merge(_ updated: Discount) {
        var list = discounts
        if let index = list.firstIndex(where: { $0.id == updated.id }) {
            list[index] = updated
        } else {
            list.insert(updated, at: 0)
        }
        state = .loaded(list)
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
