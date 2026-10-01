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

    /// Liste sayfa boyutu — sunucunun varsayılanıyla (50) aynı ama açıkça
    /// gönderiliyor: sunucu varsayılanı değişirse kaydırma davranışı sessizce
    /// değişmesin.
    static let pageSize = 50

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

    /// Liste üstündeki özet şeridi. Süs niteliğinde: hata sessizce yutulur
    /// ve şerit gizli kalır — listeyi okumayı engellememeli.
    private(set) var summary: CustomerSummary?

    /// Liste ekranının etiket filtresi. `nil` = tüm müşteriler.
    ///
    /// Filtrelenmiş liste ``state``'e YAZILMAZ: ``customers`` randevu akışının
    /// müşteri seçicisini de besliyor ve bir etiket filtresinin orayı daraltması
    /// "müşteri bulunamadı" hatası gibi görünürdü.
    private(set) var selectedTagId: String?
    private(set) var filteredState: LoadState<[Customer]>?
    private var filteredCursor: String?
    private var filterTask: Task<Void, Never>?

    init(service: any CustomerService) {
        self.service = service
    }

    var customers: [Customer] { state.value ?? [] }
    var tags: [CustomerTag] { tagState.value ?? [] }

    /// Kimlikle kayıt. Yalnız sayfalanmış listeye BAKMAZ: arama ya da etiket
    /// filtresiyle bulunan bir müşteri ilk sayfalarda olmayabilir ve o zaman
    /// listede görünen kaydın kartı "müşteri bulunamadı" diyordu.
    func customer(id: String) -> Customer? {
        customers.first { $0.id == id }
            ?? searchState?.value?.first { $0.id == id }
            ?? filteredState?.value?.first { $0.id == id }
            ?? resolved[id]
    }

    /// Yüklü listelerin dışında kalıp kimlikle ya da aramayla getirilen kayıtlar
    /// (randevu akışının seçicisi, randevudan açılan kart).
    private var resolved: [String: Customer] = [:]

    /// Kayıt elde yoksa sunucudan getirir. `false` = gerçekten yok (arşivlenmiş)
    /// ya da alınamadı.
    @discardableResult
    func resolve(id: String) async -> Bool {
        if customer(id: id) != nil { return true }
        guard let found = try? await service.customer(id: id) else { return false }
        resolved[found.id] = found
        return true
    }

    /// Seçiciler için sunucu araması — sonuçlar ``customer(id:)`` için saklanır.
    /// Hata boş sonuçtur: seçici yerel eşleşmeleri göstermeye devam eder.
    func lookup(_ term: String) async -> [Customer] {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2, let found = try? await service.search(trimmed, limit: 20) else {
            return []
        }
        for customer in found { resolved[customer.id] = customer }
        return found
    }

    /// Ekranın çizeceği liste: arama etkinse sonucu, değilse sayfalanmış liste.
    ///
    /// Arama ucu `tagId` almıyor; etiket seçiliyken arama sonucu istemcide
    /// daraltılır (arama sayfalanmadığı için eksik sonuç riski yok).
    var visible: LoadState<[Customer]> {
        if let searchState {
            guard let tagId = selectedTagId, let found = searchState.value else { return searchState }
            return .loaded(found.filter { $0.tags.contains { $0.id == tagId } })
        }
        return filteredState ?? state
    }

    /// Arama etkinken "daha fazla yükle" gösterilmez — arama sayfalanmıyor.
    var canLoadMore: Bool { loadMoreCursor != nil }

    /// Ekrandaki listenin sıradaki sayfa anahtarı. Liste sonundaki tetikleyici
    /// buna bağlı: her yeni sayfada DEĞİŞTİĞİ için tetikleyici hâlâ görünürken
    /// (kısa bir sayfa ekranı doldurmadıysa) bir sonraki sayfa da istenir.
    var loadMoreCursor: String? {
        guard searchState == nil else { return nil }
        return selectedTagId == nil ? nextCursor : filteredCursor
    }

    // MARK: Okuma

    func load(force: Bool = false) async {
        if !force, state.value != nil { return }
        // İlk yüklemede iskelet; yenilemede eldeki liste ekranda kalır.
        //
        // Yenilemede `.loading`e dönmek `KlinaraScreen`in ScrollView'unu söküp
        // iskeleti koyuyordu: aşağı çekerek yenileyen `.refreshable` görevi
        // bununla birlikte iptal oluyor, iptal edilen istek sessiz hata olarak
        // `.failed`a düşüyor ve o da iskeleti çizmeye devam ediyordu — yani
        // liste yükleme durumunda takılı kalıyordu.
        if state.value == nil { state = .loading }
        do {
            let page = try await service.customers(cursor: nil, limit: Self.pageSize, tagId: nil)
            state = .loaded(page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch let error as APIError where error.isSilent {
            // İptal hata DEĞİL; eldeki durum olduğu gibi kalır.
            return
        } catch {
            guard !Task.isCancelled else { return }
            // Yenileme hatası yüklü listeyi düşürmez.
            if state.value == nil { state = .failed(error as? APIError ?? .network) }
        }
    }

    /// Aşağı çekerek yenileme. Görünen liste hangisiyse onu yerinde tazeler:
    /// etiket filtresi açıkken yalnız süzülmemiş listeyi çekmek ekrandaki
    /// listeyi hiç değiştirmezdi.
    func reload() async {
        async let list: Void = load(force: true)
        async let filtered: Void = refreshFiltered()
        async let stats: Void = loadSummary()
        _ = await (list, filtered, stats)
    }

    private func refreshFiltered() async {
        guard let tagId = selectedTagId else { return }
        do {
            let page = try await service.customers(cursor: nil, limit: Self.pageSize, tagId: tagId)
            guard selectedTagId == tagId else { return }
            filteredState = .loaded(page.data)
            filteredCursor = page.pageInfo.nextCursor
        } catch {
            // Yenileme hatası eldeki filtreli listeyi düşürmez.
        }
    }

    func loadSummary() async {
        if let fresh = try? await service.summary() { summary = fresh }
    }

    /// Sonraki sayfa. Cursor yoksa ya da bir sayfa zaten yolda ise hiçbir şey
    /// yapmaz — liste sonuna gelindiğinde görünen tetikleyici birden çok kez
    /// çizilebiliyor.
    func loadMore() async {
        if let tagId = selectedTagId {
            await loadMoreFiltered(tagId: tagId)
            return
        }
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.customers(
                cursor: cursor,
                limit: Self.pageSize,
                tagId: nil
            )
            state = .loaded(customers + page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            // Sayfa hatası TÜM listeyi düşürmez: elde olan kayıtlar duruyor,
            // kullanıcı tekrar deneyebilir.
            nextCursor = cursor
        }
    }

    /// Etiket filtresi. Aynı etikete tekrar dokunmak filtreyi temizler.
    func selectTag(_ tagId: String?) {
        let next = selectedTagId == tagId ? nil : tagId
        guard next != selectedTagId else { return }
        selectedTagId = next
        filterTask?.cancel()
        filteredCursor = nil
        guard let next else {
            filteredState = nil
            return
        }
        filteredState = .loading
        filterTask = Task { [service] in
            do {
                let page = try await service.customers(cursor: nil, limit: Self.pageSize, tagId: next)
                guard !Task.isCancelled, self.selectedTagId == next else { return }
                self.filteredState = .loaded(page.data)
                self.filteredCursor = page.pageInfo.nextCursor
            } catch {
                guard !Task.isCancelled, self.selectedTagId == next else { return }
                self.filteredState = .failed(error as? APIError ?? .network)
            }
        }
    }

    func reloadFiltered() {
        let tagId = selectedTagId
        selectedTagId = nil
        selectTag(tagId)
    }

    private func loadMoreFiltered(tagId: String) async {
        guard let cursor = filteredCursor, !isLoadingMore, let loaded = filteredState?.value else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.customers(cursor: cursor, limit: Self.pageSize, tagId: tagId)
            guard selectedTagId == tagId else { return }
            filteredState = .loaded(loaded + page.data)
            filteredCursor = page.pageInfo.nextCursor
        } catch {
            filteredCursor = cursor
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
            Task { await loadSummary() }
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
            Task { await loadSummary() }
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
        if resolved[customer.id] != nil { resolved[customer.id] = customer }
        state = .loaded(customers.map { $0.id == customer.id ? customer : $0 })
        if let filtered = filteredState?.value {
            filteredState = .loaded(filtered.map { $0.id == customer.id ? customer : $0 })
        }
        if let found = searchState?.value {
            searchState = .loaded(found.map { $0.id == customer.id ? customer : $0 })
        }
    }

    private func remove(_ id: String) {
        resolved[id] = nil
        state = .loaded(customers.filter { $0.id != id })
        if let filtered = filteredState?.value {
            filteredState = .loaded(filtered.filter { $0.id != id })
        }
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
