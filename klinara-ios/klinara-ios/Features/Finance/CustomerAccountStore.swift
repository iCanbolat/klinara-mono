import SwiftUI

/// Tek bir müşterinin cari hesabı, açık kalemleri ve tahsilatları.
///
/// ``CustomerPackagesStore`` ile aynı ömür: kartla doğar, kartla ölür.
///
/// **Bakiye burada hesaplanmaz.** `account.balanceMinor` sunucudaki
/// `customer_account_entries` view'ının yansımasıdır; her yazma sonrası hesap
/// yeniden çekilir. Yerelde ikinci bir toplam tutmak, senkron kalması gereken
/// üçüncü bir gerçek kaynağı yaratırdı — sunucu tarafındaki kararın aynısı.
@MainActor
@Observable
final class CustomerAccountStore {

    private let service: any FinanceService
    let customerId: String

    private(set) var state: LoadState<CustomerAccount> = .loading
    /// Açık kalemler ayrı çekiliyor: cari defter tahsilatları da içeriyor ve
    /// tahsilat sheet'inin ihtiyacı olan şey **hangi kalemin ne kadarı açık**.
    private(set) var chargesState: LoadState<[Charge]> = .loading
    private(set) var payments: [Payment] = []
    private(set) var nextEntryCursor: String?
    private(set) var isLoadingMore = false
    private(set) var isSaving = false

    init(customerId: String, service: any FinanceService) {
        self.customerId = customerId
        self.service = service
    }

    var account: CustomerAccount? { state.value }
    var charges: [Charge] { chargesState.value ?? [] }

    /// Tahsilat yapılabilecek kalemler — iptal edilmişler ve tamamı kapanmış
    /// olanlar listede durmaz.
    var openCharges: [Charge] {
        charges
            .filter { $0.status == .open && remainingBalance(of: $0) > 0 }
            .sorted { $0.createdAt < $1.createdAt }
    }

    /// Bir kalemin kapanmamış kısmı. Tahsis satırları **iptal edilmemiş**
    /// tahsilatlardan toplanır: iptal satırı silmez ama bakiyeyi geri getirir.
    func remainingBalance(of charge: Charge) -> Int {
        let allocated = payments
            .filter { $0.status == .posted }
            .flatMap(\.allocations)
            .filter { $0.chargeId == charge.id }
            .reduce(0) { $0 + $1.amountMinor }
        return max(0, charge.totalMinor - allocated)
    }

    // MARK: Okuma

    func load() async {
        state = .loading
        chargesState = .loading
        async let accountTask = loadAccount()
        async let chargesTask = loadCharges()
        async let paymentsTask = loadPayments()
        _ = await (accountTask, chargesTask, paymentsTask)
    }

    /// Yazma sonrası tazeleme — `.loading`a düşürmeden. Ekranın altındaki
    /// listenin bir anlığına boşalması, işlemin bir şeyi sildiği izlenimi verir.
    func refresh() async {
        async let accountTask = loadAccount(resetState: false)
        async let chargesTask = loadCharges(resetState: false)
        async let paymentsTask = loadPayments()
        _ = await (accountTask, chargesTask, paymentsTask)
    }

    private func loadAccount(resetState: Bool = true) async {
        if resetState { state = .loading }
        do {
            let account = try await service.account(customerId: customerId, cursor: nil, limit: nil)
            state = .loaded(account)
            nextEntryCursor = account.pageInfo.nextCursor
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func loadCharges(resetState: Bool = true) async {
        if resetState { chargesState = .loading }
        do {
            let page = try await service.charges(
                cursor: nil,
                limit: nil,
                customerId: customerId,
                branchId: nil,
                source: nil,
                status: nil,
                from: nil,
                to: nil
            )
            chargesState = .loaded(page.data)
        } catch {
            chargesState = .failed(error as? APIError ?? .network)
        }
    }

    private func loadPayments() async {
        guard let page = try? await service.payments(
            cursor: nil,
            limit: nil,
            customerId: customerId,
            branchId: nil,
            method: nil,
            status: nil,
            from: nil,
            to: nil
        ) else { return }
        payments = page.data
    }

    /// Cari defterin sonraki sayfası. Yalnız `entries` sayfalanıyor; toplamlar
    /// her sayfada aynı geliyor ve yeniden yazılmıyor.
    func loadMoreEntries() async {
        guard let cursor = nextEntryCursor, !isLoadingMore, let current = account else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.account(customerId: customerId, cursor: cursor, limit: nil)
            state = .loaded(CustomerAccount(
                customerId: current.customerId,
                chargedMinor: current.chargedMinor,
                paidMinor: current.paidMinor,
                balanceMinor: current.balanceMinor,
                currency: current.currency,
                entries: current.entries + page.entries,
                pageInfo: page.pageInfo
            ))
            nextEntryCursor = page.pageInfo.nextCursor
        } catch {
            // Elde olan sayfalar duruyor; cursor korunuyor ki tekrar denenebilsin.
            nextEntryCursor = cursor
        }
    }

    // MARK: Yazma
    //
    // Hepsi aynı deseni izler: yaz, hesabı tazele, hatayı çağırana FIRLAT.
    // Yazımdan sonra tazelemek şart: bakiye sunucuda hesaplanıyor ve yerelde
    // tahmin etmek ekranda yanlış bir rakam göstermenin en kestirme yolu.

    func createCharge(_ input: CreateChargeInput, idempotencyKey: String) async throws -> Charge {
        try await mutating {
            let created = try await service.createCharge(input, idempotencyKey: idempotencyKey)
            await refresh()
            return created
        }
    }

    func updateCharge(id: String, version: Int, _ input: UpdateChargeInput) async throws -> Charge {
        try await mutating {
            let updated = try await service.updateCharge(id: id, version: version, input)
            await refresh()
            return updated
        }
    }

    func voidCharge(id: String, version: Int, reason: String) async throws {
        _ = try await mutating {
            let updated = try await service.voidCharge(id: id, version: version, reason: reason)
            await refresh()
            return updated
        }
    }

    func createPayment(_ input: CreatePaymentInput, idempotencyKey: String) async throws -> Payment {
        try await mutating {
            let created = try await service.createPayment(input, idempotencyKey: idempotencyKey)
            await refresh()
            return created
        }
    }

    func voidPayment(id: String, version: Int, reason: String) async throws {
        _ = try await mutating {
            let updated = try await service.voidPayment(id: id, version: version, reason: reason)
            await refresh()
            return updated
        }
    }

    func createRefund(_ input: CreateRefundInput, idempotencyKey: String) async throws -> Refund {
        try await mutating {
            let created = try await service.createRefund(input, idempotencyKey: idempotencyKey)
            await refresh()
            return created
        }
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
