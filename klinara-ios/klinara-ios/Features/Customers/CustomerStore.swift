import SwiftUI

/// Müşteri listesinin oturum ömürlü kopyası.
///
/// Randevu oluştururken müşteri seçmek gerekiyor; her açılışta listeyi yeniden
/// çekmek yerine ``StaffStore``'un kalıbı: bir kez yükle, yazmaları yerelde işle.
///
/// Batch 4.1'den beri iki ayrı okuma yolu var ve **karıştırılmamalı**:
/// gezinme `GET /customers` cursor sayfalamasıyla, arama `GET /customers/search`
/// ile yapılıyor. Aramayı yüklü sayfa üzerinde yerel filtreye bırakmak,
/// kullanıcının hiç görmediği 400 kaydı aramamak demekti.
@MainActor
@Observable
final class CustomerStore {

    private let service: any CustomerService

    private(set) var state: LoadState<[Customer]> = .loading
    private(set) var isSaving = false

    /// Sonraki sayfanın anahtarı; `nil` ise liste tamamlanmış.
    private(set) var nextCursor: String?
    private(set) var isLoadingMore = false

    /// Arama sonucu. `nil` **arama yapılmıyor** demektir — boş sonuçtan farklı.
    private(set) var searchState: LoadState<[Customer]>?
    private var searchTask: Task<Void, Never>?
    private var searchTerm = ""

    private(set) var tagState: LoadState<[CustomerTag]> = .loading

    init(service: any CustomerService) {
        self.service = service
    }

    var customers: [Customer] { state.value ?? [] }
    var tags: [CustomerTag] { tagState.value ?? [] }

    func customer(id: String) -> Customer? { customers.first { $0.id == id } }

    /// Ekranın çizeceği liste: arama etkinse sonucu, değilse sayfalanmış liste.
    var visible: LoadState<[Customer]> { searchState ?? state }

    /// Arama etkinken "daha fazla yükle" gösterilmez — arama sayfalanmıyor.
    var canLoadMore: Bool { searchState == nil && nextCursor != nil }

    // MARK: Okuma

    func load(force: Bool = false) async {
        if !force, state.value != nil { return }
        state = .loading
        nextCursor = nil
        do {
            let page = try await service.customers(cursor: nil, limit: nil, tagId: nil, source: nil)
            state = .loaded(page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func reload() async { await load(force: true) }

    /// Sonraki sayfa. Cursor yoksa ya da bir sayfa zaten yolda ise hiçbir şey
    /// yapmaz — liste sonuna gelindiğinde görünen tetikleyici birden çok kez
    /// çizilebiliyor.
    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.customers(
                cursor: cursor,
                limit: nil,
                tagId: nil,
                source: nil
            )
            state = .loaded(customers + page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            // Sayfa hatası TÜM listeyi düşürmez: elde olan kayıtlar duruyor,
            // kullanıcı tekrar deneyebilir.
            nextCursor = cursor
        }
    }

    func loadTags(force: Bool = false) async {
        if !force, tagState.value != nil { return }
        tagState = .loading
        do {
            tagState = .loaded(try await service.tags())
        } catch {
            tagState = .failed(error as? APIError ?? .network)
        }
    }

    // MARK: Arama

    /// Terim değiştiğinde çağrılır. 250 ms bekler, süren aramayı iptal eder.
    ///
    /// Her tuşa bir istek atmak sunucuya da kullanıcıya da zarar: yanıtlar
    /// sırasız dönerse ekranda daha eski bir terimin sonucu kalırdı.
    func updateSearch(_ term: String) {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != searchTerm else { return }
        searchTerm = trimmed
        searchTask?.cancel()

        // Sunucu en az 2 karakter istiyor; altında arama YAPILMIYOR sayılır ve
        // sayfalanmış listeye dönülür.
        guard trimmed.count >= 2 else {
            searchState = nil
            return
        }

        searchState = .loading
        searchTask = Task { [service] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            do {
                let found = try await service.search(trimmed, limit: nil)
                guard !Task.isCancelled, self.searchTerm == trimmed else { return }
                self.searchState = .loaded(found)
            } catch let error as APIError {
                // İptal edilen istek hata değildir — kullanıcı yazmaya devam etti.
                guard !Task.isCancelled else { return }
                if case .cancelled = error { return }
                self.searchState = .failed(error)
            } catch {
                guard !Task.isCancelled else { return }
                self.searchState = .failed(.network)
            }
        }
    }

    func retrySearch() {
        let term = searchTerm
        searchTerm = ""
        updateSearch(term)
    }

    // MARK: Yazma

    func create(_ input: CreateCustomerInput) async throws -> Customer {
        try await mutating {
            let created = try await service.create(input)
            // Sunucu listeyi en yeniden eskiye sıralıyor; yeni kayıt başa girer.
            state = .loaded([created] + customers)
            return created
        }
    }

    func update(id: String, _ input: UpdateCustomerInput) async throws -> Customer {
        try await mutating {
            let updated = try await service.update(id: id, input)
            replace(updated)
            return updated
        }
    }

    /// Arşivler. Kayıt listeden düşer — sunucuda `deletedAt` doluyor ve
    /// `GET /customers` onu bir daha döndürmüyor.
    func archive(id: String) async throws -> Customer {
        try await mutating {
            let archived = try await service.archive(id: id)
            remove(id)
            return archived
        }
    }

    func replaceTags(customerId: String, tagIds: [String]) async throws -> Customer {
        try await mutating {
            let updated = try await service.replaceTags(customerId: customerId, tagIds: tagIds)
            replace(updated)
            return updated
        }
    }

    /// Birleştirir: kaynak listeden düşer, hedef sunucunun döndürdüğü hâliyle
    /// değişir. Kaynağın kartı açıksa artık bulunamayacak — çağıran ekran geri
    /// dönmeli.
    func merge(into targetId: String, sourceId: String) async throws -> CustomerMergeResult {
        try await mutating {
            let result = try await service.merge(into: targetId, sourceId: sourceId)
            remove(sourceId)
            replace(result.customer)
            // Arama sonucu artık bayat: arşivlenmiş kaydı gösteriyor olabilir.
            searchState = nil
            searchTerm = ""
            return result
        }
    }

    // MARK: Etiket yönetimi

    func createTag(_ input: CustomerTagInput) async throws -> CustomerTag {
        try await mutating {
            let tag = try await service.createTag(input)
            tagState = .loaded(sorted(tags + [tag]))
            return tag
        }
    }

    func updateTag(id: String, _ input: CustomerTagInput) async throws -> CustomerTag {
        try await mutating {
            let tag = try await service.updateTag(id: id, input)
            tagState = .loaded(sorted(tags.map { $0.id == id ? tag : $0 }))
            // Karttaki rozetler de bu adı taşıyor.
            state = .loaded(customers.map { customer in
                guard customer.tags.contains(where: { $0.id == id }) else { return customer }
                return customer.replacingTags(customer.tags.map { $0.id == id ? tag : $0 })
            })
            return tag
        }
    }

    func deleteTag(id: String) async throws {
        try await mutating {
            try await service.deleteTag(id: id)
            tagState = .loaded(tags.filter { $0.id != id })
            state = .loaded(customers.map { customer in
                guard customer.tags.contains(where: { $0.id == id }) else { return customer }
                return customer.replacingTags(customer.tags.filter { $0.id != id })
            })
        }
    }

    // MARK: Yardımcılar

    private func sorted(_ tags: [CustomerTag]) -> [CustomerTag] {
        tags.sorted { SearchText.fold($0.name) < SearchText.fold($1.name) }
    }

    private func replace(_ customer: Customer) {
        state = .loaded(customers.map { $0.id == customer.id ? customer : $0 })
        if let found = searchState?.value {
            searchState = .loaded(found.map { $0.id == customer.id ? customer : $0 })
        }
    }

    private func remove(_ id: String) {
        state = .loaded(customers.filter { $0.id != id })
        if let found = searchState?.value {
            searchState = .loaded(found.filter { $0.id != id })
        }
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
