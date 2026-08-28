import SwiftUI

/// Kasa oturumları — açık oturum, geçmiş ve seçili oturumun özeti.
///
/// **Oturum ömürlü**, ``PackageDefinitionStore`` gibi: nakit tahsilat sheet'i
/// "açık kasa hangisi?" sorusunu soruyor ve kasa ekranı da aynı listeye
/// bakıyor. Ekran başına kurmak, tahsilat sheet'inin kasa ekranından farklı
/// bir "açık kasa" görmesi demekti.
@MainActor
@Observable
final class CashSessionStore {

    private let service: any FinanceService

    private(set) var state: LoadState<[CashSession]> = .loading
    private(set) var nextCursor: String?
    private(set) var isLoadingMore = false
    private(set) var isSaving = false

    /// `sessionId` → özet. Detay ekranları arasında gidip gelirken yeniden
    /// çekmemek için sözlük — ``CustomerPackagesStore/ledgers`` ile aynı gerekçe.
    private(set) var summaries: [String: LoadState<CashSessionSummary>] = [:]

    init(service: any FinanceService) {
        self.service = service
    }

    var sessions: [CashSession] { state.value ?? [] }

    /// Seçili şubede açık olan kasa. Şube başına **en fazla bir** tane olabilir;
    /// sunucudaki kısmi tekil indeks bunu garanti ediyor.
    func openSession(in branchId: String?) -> CashSession? {
        sessions.first { $0.isOpen && (branchId == nil || $0.branchId == branchId) }
    }

    // MARK: Okuma

    func load() async {
        state = .loading
        nextCursor = nil
        do {
            let page = try await service.cashSessions(
                cursor: nil,
                limit: nil,
                branchId: nil,
                status: nil
            )
            state = .loaded(page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    /// İlk yüklemede bir kez — sheet'ler açık kasayı bilmek zorunda ve her
    /// açılışta listeyi baştan çekmek gereksiz istek demek.
    func loadIfNeeded() async {
        guard state.value == nil else { return }
        await load()
    }

    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.cashSessions(
                cursor: cursor,
                limit: nil,
                branchId: nil,
                status: nil
            )
            state = .loaded(sessions + page.data)
            nextCursor = page.pageInfo.nextCursor
        } catch {
            nextCursor = cursor
        }
    }

    func summary(for sessionId: String) -> LoadState<CashSessionSummary> {
        summaries[sessionId] ?? .loading
    }

    func loadSummary(sessionId: String) async {
        summaries[sessionId] = .loading
        do {
            summaries[sessionId] = .loaded(try await service.cashSessionSummary(id: sessionId))
        } catch {
            summaries[sessionId] = .failed(error as? APIError ?? .network)
        }
    }

    // MARK: Yazma

    func open(openingBalanceMinor: Int) async throws -> CashSession {
        try await mutating {
            let created = try await service.openCashSession(
                OpenCashSessionInput(openingBalanceMinor: openingBalanceMinor)
            )
            state = .loaded([created] + sessions)
            return created
        }
    }

    func close(
        sessionId: String,
        version: Int,
        countedMinor: Int,
        differenceReason: String?
    ) async throws -> CashSession {
        try await mutating {
            let closed = try await service.closeCashSession(
                id: sessionId,
                version: version,
                CloseCashSessionInput(
                    countedMinor: countedMinor,
                    differenceReason: differenceReason
                )
            )
            merge(closed)
            // Özet de tazeleniyor: kapanış `expectedMinor`ı dondurur ve eski
            // özet artık kapanmış bir oturumu açıkmış gibi anlatırdı.
            await loadSummary(sessionId: sessionId)
            return closed
        }
    }

    /// Tahsilat ya da iade sonrası, açık kasanın özetini tazeler. Kasa ekranı
    /// açık olmasa da çağrılabilir — hareket eklendiğinde beklenen tutar değişir.
    func refreshSummaryIfLoaded(sessionId: String) async {
        guard summaries[sessionId] != nil else { return }
        await loadSummary(sessionId: sessionId)
    }

    private func merge(_ updated: CashSession) {
        var list = sessions
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
