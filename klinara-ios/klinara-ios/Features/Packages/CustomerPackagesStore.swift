import SwiftUI

/// Tek bir müşterinin paketleri ve seçili paketin defteri.
///
/// ``PackageDefinitionStore`` oturum ömürlü ve **tanım** kapsamlı; satılmış
/// paketler ise karta bağlı. ``CustomerRecordStore`` ile aynı gerekçe: açılmış
/// her müşterinin defterini oturum boyunca bellekte tutmanın anlamı yok.
///
/// **Kalan hak burada hesaplanmaz.** Her yazma sonrası sunucudan dönen kayıt
/// yerel kopyaya işlenir; defterin tek otorite olduğu kural istemcide de geçerli.
@MainActor
@Observable
final class CustomerPackagesStore {

    private let service: any PackagesService
    let customerId: String

    private(set) var state: LoadState<[CustomerPackage]> = .loading
    private(set) var nextCursor: String?
    private(set) var isLoadingMore = false
    private(set) var isSaving = false

    /// Açık paketin defteri — `packageId` → satırlar. Kart içinde birden çok
    /// paket detayı açılıp kapanabildiği için sözlük.
    private(set) var ledgers: [String: LoadState<[PackageLedgerEntry]>] = [:]
    private(set) var ledgerCursors: [String: String] = [:]

    init(customerId: String, service: any PackagesService) {
        self.customerId = customerId
        self.service = service
    }

    var packages: [CustomerPackage] { state.value ?? [] }

    func package(id: String) -> CustomerPackage? {
        packages.first { $0.id == id }
    }

    /// Aktif ve hakkı kalan paketler — kartın özeti bunları öne alır.
    var openPackages: [CustomerPackage] {
        packages.filter { $0.status == .active && $0.remainingSessions > 0 }
    }

    var totalRemainingSessions: Int {
        openPackages.reduce(0) { $0 + $1.remainingSessions }
    }

    // MARK: Okuma

    func load() async {
        state = .loading
        nextCursor = nil
        do {
            let page = try await service.packages(
                customerId: customerId,
                cursor: nil,
                limit: nil,
                status: nil
            )
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
            let page = try await service.packages(
                customerId: customerId,
                cursor: cursor,
                limit: nil,
                status: nil
            )
            state = .loaded(packages + page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            // Elde olan sayfalar duruyor; cursor korunuyor ki tekrar denenebilsin.
            nextCursor = cursor
        }
    }

    /// Tek paketi tazeler. Detay ekranı açılışta bunu çağırıyor: liste ucu
    /// `version`'ı bayatlatmış olabilir ve `If-Match` bayat başlamamalı.
    func refresh(packageId: String) async {
        guard let refreshed = try? await service.package(id: packageId) else { return }
        merge(refreshed)
    }

    func ledger(for packageId: String) -> LoadState<[PackageLedgerEntry]> {
        ledgers[packageId] ?? .loading
    }

    func ledgerEntries(for packageId: String) -> [PackageLedgerEntry] {
        ledger(for: packageId).value ?? []
    }

    func canLoadMoreLedger(for packageId: String) -> Bool {
        ledgerCursors[packageId] != nil
    }

    func loadLedger(packageId: String) async {
        ledgers[packageId] = .loading
        ledgerCursors[packageId] = nil
        do {
            let page = try await service.ledger(packageId: packageId, cursor: nil, limit: nil)
            ledgers[packageId] = .loaded(page.data)
            ledgerCursors[packageId] = page.pageInfo.nextCursor
        } catch {
            ledgers[packageId] = .failed(error as? APIError ?? .network)
        }
    }

    func loadMoreLedger(packageId: String) async {
        guard let cursor = ledgerCursors[packageId], !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.ledger(packageId: packageId, cursor: cursor, limit: nil)
            ledgers[packageId] = .loaded(ledgerEntries(for: packageId) + page.data)
            ledgerCursors[packageId] = page.pageInfo.nextCursor
        } catch {
            ledgerCursors[packageId] = cursor
        }
    }

    // MARK: Yazma
    //
    // Hepsi aynı deseni izler: sunucudan dönen kaydı yerel kopyaya işle, hatayı
    // çağırana FIRLAT. Defter de tazelenir — bir işlem yapıp defterde
    // görmemek, "oldu mu olmadı mı"yı kullanıcıya sordurur.

    func sell(definitionId: String, note: String?, idempotencyKey: String) async throws -> CustomerPackage {
        try await mutating {
            let sold = try await service.sell(
                CreateCustomerPackageInput(
                    customerId: customerId,
                    definitionId: definitionId,
                    soldAt: nil,
                    note: note
                ),
                idempotencyKey: idempotencyKey
            )
            state = .loaded([sold] + packages)
            return sold
        }
    }

    func adjust(packageId: String, version: Int, _ input: AdjustPackageInput) async throws {
        _ = try await mutating {
            let updated = try await service.adjust(id: packageId, version: version, input)
            merge(updated)
            await loadLedger(packageId: packageId)
            return updated
        }
    }

    func refund(
        packageId: String,
        version: Int,
        _ input: RefundPackageInput,
        idempotencyKey: String
    ) async throws -> RefundResult {
        try await mutating {
            let result = try await service.refund(
                id: packageId,
                version: version,
                input,
                idempotencyKey: idempotencyKey
            )
            // İade yanıtı paketi DÖNDÜRMÜYOR (tutar ve seans sayısı dönüyor);
            // güncel kaydı tahmin etmek yerine yeniden çekiyoruz.
            await refresh(packageId: packageId)
            await loadLedger(packageId: packageId)
            return result
        }
    }

    func transfer(
        packageId: String,
        version: Int,
        _ input: TransferPackageInput,
        idempotencyKey: String
    ) async throws -> CustomerPackage {
        try await mutating {
            // Yanıt HEDEF müşterinin yeni paketi; kaynak paket ayrıca tazelenir.
            let created = try await service.transfer(
                id: packageId,
                version: version,
                input,
                idempotencyKey: idempotencyKey
            )
            await refresh(packageId: packageId)
            await loadLedger(packageId: packageId)
            return created
        }
    }

    // MARK: Yardımcılar

    private func merge(_ updated: CustomerPackage) {
        var list = packages
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
